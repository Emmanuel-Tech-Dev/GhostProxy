/**
 * cache/cacheManager.js
 *
 * Wraps the raw LRUCache with application-level concerns:
 * key generation, cache bypass logic (non-GET methods), and
 * the single shared cache instance.
 *
 * Design: Single Responsibility.
 * LRUCache knows nothing about HTTP. This module knows about HTTP
 * but nothing about linked lists. Each layer has one job.
 */

import LRUCache from "./LRUCache.js";

// One shared cache for the entire process. This is intentional.
// Multiple caches per route would split the capacity and reduce effectiveness.
// Route-level TTL overrides are handled at put() time, not by separate instances.
const cache = new LRUCache(
  Number(process.env.LRU_CAPACITY) || 500,
  Number(process.env.LRU_TTL_MS) || 30000,
);

// Inflight Map for request coalescing.
//
// WHY THIS EXISTS - THE CACHE STAMPEDE PROBLEM:
// When a cache entry expires and 500 concurrent requests arrive simultaneously,
// all 500 see a cache MISS and fire upstream calls independently. The upstream
// receives 500 identical requests at once - a self-inflicted DDoS.
//
// THE FIX - REQUEST COALESCING:
// When a cache MISS occurs, instead of immediately going upstream, we first
// check this Map. If a Promise is already stored for this cache key, another
// request is already in-flight to the upstream for the same resource. We
// attach to that existing Promise and wait for it to resolve. This guarantees
// exactly ONE upstream call per unique resource, regardless of how many
// concurrent requests arrive during the window.
//
// Key:   the same cache key string used by the LRU (method:host:path?query)
// Value: a Promise that resolves to { statusCode, headers, body }
//
// The Map entry is deleted immediately after the upstream call completes,
// whether it succeeded or failed. This prevents a failed request from
// permanently blocking future requests for the same key.
const inflight = new Map();

/**
 * Builds a deterministic cache key from an HTTP request.
 *
 * We include: method, host header, path, and sorted query string.
 * We deliberately exclude: authorization headers, cookies, and request body.
 *
 * WHY SORT QUERY PARAMS?
 * "GET /items?sort=asc&page=2" and "GET /items?page=2&sort=asc" are semantically
 * identical but would produce different strings if not sorted. Sorting ensures
 * they share one cache slot.
 *
 * WHY EXCLUDE BODY?
 * GET requests must not have a meaningful body per HTTP spec. We only cache GET.
 * If we ever cache POST (idempotent RPCs), we would hash the body and append it.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function buildCacheKey(req) {
  const sortedQuery = Object.keys(req.query)
    .sort()
    .map((k) => `${k}=${req.query[k]}`)
    .join("&");

  const host = req.headers["host"] || "";
  return `${req.method}:${host}:${req.path}${sortedQuery ? "?" + sortedQuery : ""}`;
}

/**
 * Determines if a request is eligible to be served from cache.
 * Only GET requests are cached. Everything else mutates state.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isCacheable(req) {
  return req.method === "GET";
}

/**
 * Checks the cache for a stored response for the given request.
 * Returns the cached entry or null.
 *
 * @param {import('express').Request} req
 * @returns {{ statusCode: number, headers: object, body: Buffer } | null}
 */
function getCachedResponse(req) {
  if (!isCacheable(req)) return null;
  const key = buildCacheKey(req);
  return cache.get(key);
}

/**
 * Stores a response in the cache.
 *
 * @param {import('express').Request} req
 * @param {{ statusCode: number, headers: object, body: Buffer }} responseData
 * @param {number} [ttlMs] - Route-specific TTL override.
 */
function setCachedResponse(req, responseData, ttlMs) {
  if (!isCacheable(req)) return;

  // Do not cache error responses. A 500 from the upstream should not be
  // served to subsequent clients; the upstream may recover.
  if (responseData.statusCode >= 400) return;

  const key = buildCacheKey(req);
  cache.put(key, responseData, ttlMs);
}

/**
 * getOrFetch - the coalescing entry point.
 *
 * This is the function the interceptor should call instead of the separate
 * getCachedResponse / forwardRequest / setCachedResponse sequence.
 *
 * It handles the full "get or fetch" cycle in one place:
 * 1. Check LRU cache. HIT -> return immediately.
 * 2. Check inflight Map. In-flight -> attach to existing Promise.
 * 3. MISS + no in-flight -> call fetchFn(), store Promise, await result,
 *    populate cache, delete from inflight Map, return result.
 *
 * WHY fetchFn AS A CALLBACK?
 * cacheManager must not know how to talk to the upstream. That is the
 * interceptor's job. Accepting fetchFn as a parameter keeps cacheManager
 * focused on caching and coalescing only. The caller owns the fetch logic.
 *
 * @param {import('express').Request} req
 * @param {() => Promise<{ statusCode: number, headers: object, body: Buffer }>} fetchFn
 * @param {number} [ttlMs] - Route-specific TTL override.
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer, fromCache: boolean, coalesced: boolean }>}
 */
async function getOrFetch(req, fetchFn, ttlMs) {
  // Non-cacheable requests (POST, PUT, DELETE) skip all coalescing logic
  // and go straight to the upstream via fetchFn.
  if (!isCacheable(req)) {
    const result = await fetchFn();
    return { ...result, fromCache: false, coalesced: false };
  }

  const key = buildCacheKey(req);

  // STEP 1: LRU cache check. Fastest possible path - O(1), no async work.
  const cached = cache.get(key);
  if (cached) {
    return { ...cached, fromCache: true, coalesced: false };
  }

  // STEP 2: Inflight check. Another concurrent request is already fetching
  // this exact resource. Attach to its Promise instead of firing a new call.
  if (inflight.has(key)) {
    const result = await inflight.get(key);
    // The result came from a coalesced upstream call, not from our own fetch.
    // Mark it so the interceptor can set the correct X-Cache header value.
    return { ...result, fromCache: false, coalesced: true };
  }

  // STEP 3: Cache MISS and no in-flight request. We are the designated fetcher.
  // Create the Promise, store it immediately in the inflight Map BEFORE awaiting,
  // so any concurrent requests that arrive while we are in-flight hit STEP 2.
  //
  // WHY STORE BEFORE AWAIT?
  // If we awaited first and then stored, there would be a gap between the
  // await and the store where concurrent requests would still see no inflight
  // entry and fire their own upstream calls. Storing first closes that gap.
  const fetchPromise = fetchFn();
  inflight.set(key, fetchPromise);

  let result;
  try {
    result = await fetchPromise;

    // Only cache successful responses. A 500 from the upstream should not
    // be served to subsequent clients - the upstream may recover.
    if (result.statusCode < 400) {
      cache.put(key, result, ttlMs);
    }
  } finally {
    // Always delete from inflight Map, whether the fetch succeeded or failed.
    // If we leave a failed Promise in the Map, all future requests for this
    // key will keep attaching to a rejected Promise and get errors forever.
    inflight.delete(key);
  }

  return { ...result, fromCache: false, coalesced: false };
}

/**
 * Returns the current size of the inflight Map.
 * Exposed for the analytics dashboard - high inflight count indicates
 * heavy concurrent load on a cold or expiring cache.
 */
function getInflightCount() {
  return inflight.size;
}

/**
 * Exposes the raw LRU instance for metric reporting.
 */
function getCacheMetrics() {
  return { ...cache.getMetrics(), inflightRequests: inflight.size };
}

export {
  getCachedResponse,
  setCachedResponse,
  getOrFetch,
  getInflightCount,
  getCacheMetrics,
  buildCacheKey,
};
