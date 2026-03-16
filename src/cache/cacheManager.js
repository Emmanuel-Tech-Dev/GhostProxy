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
  Number(process.env.LRU_TTL_MS) || 30000
);

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
 * Exposes the raw LRU instance for metric reporting.
 */
function getCacheMetrics() {
  return cache.getMetrics();
}

export { getCachedResponse, setCachedResponse, getCacheMetrics, buildCacheKey };
