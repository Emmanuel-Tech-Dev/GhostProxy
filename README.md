# GHOSTPROXY

### Smart Observability Wrapper

> Add Caching, Analytics, and Rate-Limiting to any API in 60 seconds.

---

## What Is GhostProxy?

GhostProxy is a Node.js sidecar proxy that sits transparently in front of any existing HTTP API. It adds caching, analytics, and rate-limiting to APIs you cannot or do not want to modify. Point your clients at GhostProxy instead of the original API, register your routes once, and every request is automatically observed, cached, and rate-limited.

> **Why it exists:** Many companies have legacy or black-box APIs that are slow, have no analytics, and lack rate-limiting. Replacing them is expensive. GhostProxy upgrades them without touching a single line of the original codebase.

---

## System Architecture

Every request passes through a fixed, ordered pipeline. Each stage is independent and can be enabled or disabled per route.

```
Client Request
     |
     v
+--------------------+
|  Route Registry    |  matchRoute() - longest prefix wins
+--------------------+
     |  matched
     v
+--------------------+
|  Token Bucket      |  Per-IP rate limiter. 429 if exhausted.
|  Rate Limiter      |
+--------------------+
     |  allowed
     v
+--------------------+
|  LRU Cache         |  O(1) get. Returns <5ms on HIT.
+--------------------+
     |  MISS
     v
+--------------------+
|  Upstream Proxy    |  Forwards to real API. Captures response.
+--------------------+
     |
     v
+--------------------+
|  Cache Store       |  PUT response for next request.
+--------------------+
     |
     v
+--------------------+
|  Batch Logger      |  Buffer entry. Flush every 10s or 1000 reqs.
+--------------------+
     |
     v
Response to Client
```

---

## Design Patterns & Why

Every architectural decision is deliberate. Here is the rationale behind each pattern used.

### Proxy / Interceptor Pattern

The core of GhostProxy. The interceptor middleware sits between client and upstream. It is the Decorator Pattern at the network level: we add capabilities (caching, rate-limiting, logging) without modifying the wrapped system. The upstream API has zero awareness of GhostProxy's existence.

### LRU Cache — Doubly Linked List + HashMap

Built from scratch rather than a library to give full control over TTL eviction and metric reporting.

- **HashMap** gives O(1) key lookup.
- **Doubly Linked List** gives O(1) promotion (on hit) and O(1) eviction (at tail).
- A plain `Map` gives insertion-order but not recency. That is why the DLL is needed.

TTL is checked lazily at read time — no background timer. Expired entries are displaced by new ones or found stale on the next `get()`. This avoids timer thrashing on high-cardinality caches.

### Buffer-and-Batch Logger — Producer / Consumer

Writing one MySQL `INSERT` per request is synchronous with the request lifecycle. Under load this adds 1–5ms of DB latency to every response.

The batch logger decouples the hot path from the DB:

- `log()` appends to an in-memory array in ~0ms (the producer).
- A background interval flushes all buffered rows in a single multi-row `INSERT` every 10 seconds or 1,000 entries (the consumer).

The **atomic buffer swap** (`batch = buffer; buffer = []`) before the async `INSERT` ensures no log entry is duplicated or lost during a flush. On flush failure the batch is prepended back to the buffer for retry.

### Token Bucket Rate Limiter

Token Bucket was chosen over Fixed Window and Sliding Window.

- **Fixed Window** has the thundering herd problem: a client can exhaust the limit at 11:59:59 and again at 12:00:00, doubling burst capacity.
- **Sliding Window** requires storing a timestamp per request — memory-intensive at high traffic.
- **Token Bucket** allows controlled bursts (up to `capacity`) while enforcing a long-term average rate (`refillRate` tokens/sec). Refill is done via **virtual scheduling**: tokens are calculated lazily at `consume()` time using `(elapsedSeconds * refillRate)`, so zero background work is required.

### Registry Pattern — Route Registry

Routes are loaded from MySQL at startup into an in-memory `Map`. The proxy reads this map on every request, not the database. An atomic swap on reload means in-flight requests use the old map until the new one is fully built. A 15-second poll re-reads DB changes without requiring a server restart.

### Single Responsibility Modules

`LRUCache` knows nothing about HTTP. The interceptor knows about HTTP but nothing about linked lists. The batch logger knows about buffering but not about proxy routes. Each module has exactly one reason to change, making the codebase easy to test and easy to replace piece by piece.

---

## Project Structure

```
GhostProxy/
  .env                         Environment config (copy from .env.example)
  .env.example                 All configurable variables with descriptions
  package.json
  src/
    server.js                  Entry point. Startup and graceful shutdown.
    db/
      pool.js                  MySQL connection pool singleton
      migrate.js               One-time schema DDL runner
    cache/
      LRUCache.js              Raw data structure (DLL + HashMap)
      cacheManager.js          HTTP-aware wrapper: key generation, bypass rules
    logger/
      batchLogger.js           Buffer-and-batch producer/consumer
    ratelimiter/
      tokenBucket.js           Token Bucket algorithm + BucketStore
    proxy/
      routeRegistry.js         Route config loader and watcher
      interceptor.js           Core middleware (chain of responsibility)
    routes/
      routesApi.js             CRUD endpoints for managing routes
      analyticsApi.js          Dashboard analytics query endpoints
    middleware/
      errorHandler.js          Central error shape
```

---

## Prerequisites

- Node.js 18 or higher (ESM modules required)
- MySQL 8.0 or higher
- npm 9 or higher

---

## Installation & Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example env file and fill in your MySQL credentials:

```bash
cp .env.example .env
```

| Variable                 | Description / Default                                   |
| ------------------------ | ------------------------------------------------------- |
| `PORT`                   | HTTP port the proxy listens on. Default: `4000`         |
| `DB_HOST`                | MySQL host. Default: `localhost`                        |
| `DB_PORT`                | MySQL port. Default: `3306`                             |
| `DB_USER`                | MySQL username                                          |
| `DB_PASSWORD`            | MySQL password                                          |
| `DB_NAME`                | Database name. Default: `observability_wrapper`         |
| `DEFAULT_UPSTREAM_URL`   | Fallback upstream if no route matches                   |
| `LRU_CAPACITY`           | Max unique request signatures in memory. Default: `500` |
| `LRU_TTL_MS`             | Global cache entry TTL in ms. Default: `30000` (30s)    |
| `RATE_LIMIT_CAPACITY`    | Token bucket burst ceiling. Default: `100`              |
| `RATE_LIMIT_REFILL_RATE` | Tokens added per second. Default: `10`                  |
| `LOG_BUFFER_MAX_SIZE`    | Flush to DB when buffer hits this size. Default: `1000` |
| `LOG_FLUSH_INTERVAL_MS`  | Flush to DB every N ms. Default: `10000` (10s)          |

### 3. Run the database migration

Creates the database and all three tables (`routes`, `request_logs`, `api_keys`). Safe to run multiple times — uses `CREATE TABLE IF NOT EXISTS`.

```bash
node src/db/migrate.js
```

### 4. Start the server

```bash
# Development (auto-restart on file change)
npm run dev

# Production
npm start
```

On successful startup:

```
[RouteRegistry] Loaded 0 active routes.
[BatchLogger] Started. Flushing every 10000ms or every 1000 entries.
[Server] Observability Wrapper running on port 4000
[Server] Management API: http://localhost:4000/api
[Server] Health check:   http://localhost:4000/health
```

---

## Quick Start: Wrapping Your First API

### Step 1 — Register a route (once)

POST to the management API to tell GhostProxy what to wrap and how:

```bash
curl -X POST http://localhost:4000/api/routes \
  -H "Content-Type: application/json" \
  -d '{
    "name": "JSONPlaceholder Users",
    "prefix": "/proxy/users",
    "upstream_url": "https://jsonplaceholder.typicode.com/users",
    "cache_enabled": true,
    "cache_ttl_ms": 30000,
    "rate_limit_enabled": true,
    "rate_limit_capacity": 100,
    "rate_limit_refill_rate": 10
  }'
```

### Step 2 — Use the proxy instead of the real API

```bash
# Before: client hits the real API directly
GET https://jsonplaceholder.typicode.com/users/42

# After: client hits GhostProxy (zero changes to the upstream)
GET http://localhost:4000/proxy/users/42
```

That is the complete setup. GhostProxy forwards the request, caches the response for 30 seconds, enforces the rate limit per client IP, and logs the request to MySQL in the background.

> **Tip:** The first request returns `X-Cache: MISS`. All subsequent identical requests within the TTL window return `X-Cache: HIT` and are served in under 5ms from memory.

---

## API Reference

### Routes Management

| Method   | Endpoint          | Description                          |
| -------- | ----------------- | ------------------------------------ |
| `GET`    | `/api/routes`     | List all registered routes           |
| `GET`    | `/api/routes/:id` | Get a single route by ID             |
| `POST`   | `/api/routes`     | Register a new route                 |
| `PATCH`  | `/api/routes/:id` | Partially update a route (any field) |
| `DELETE` | `/api/routes/:id` | Delete a route permanently           |

#### `POST /api/routes` — Request Body

| Field                    | Required | Description                                               |
| ------------------------ | -------- | --------------------------------------------------------- |
| `name`                   | yes      | Human-readable label for the dashboard                    |
| `prefix`                 | yes      | URL path prefix to intercept. Must start with `/`         |
| `upstream_url`           | yes      | Target API base URL requests are forwarded to             |
| `cache_enabled`          | no       | Enable LRU caching for this route. Default: `true`        |
| `cache_ttl_ms`           | no       | Per-route TTL override in ms. `null` = use global default |
| `rate_limit_enabled`     | no       | Enable token bucket rate limiting. Default: `true`        |
| `rate_limit_capacity`    | no       | Max burst tokens. Default: `100`                          |
| `rate_limit_refill_rate` | no       | Tokens added per second. Default: `10`                    |

### Analytics

| Method | Endpoint                            | Description                                                                    |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| `GET`  | `/api/analytics/overview`           | 24h summary: total requests, cache hit rate, error rate, avg latency           |
| `GET`  | `/api/analytics/requests-over-time` | Request volume bucketed by time. Params: `interval` (minute/hour/day), `hours` |
| `GET`  | `/api/analytics/by-route`           | Per-route breakdown: requests, cache rate, latency, error rate                 |
| `GET`  | `/api/analytics/status-codes`       | HTTP status code distribution with percentages                                 |
| `GET`  | `/api/analytics/top-clients`        | Top client IPs by volume. Params: `hours`, `limit`                             |
| `GET`  | `/api/analytics/recent-logs`        | Paginated raw log tail. Params: `limit`, `offset`, `route_prefix`              |

### Other

| Method | Endpoint  | Description                                      |
| ------ | --------- | ------------------------------------------------ |
| `GET`  | `/health` | Health check. Returns `{ status: 'ok', uptime }` |

---

## How Route Matching Works

GhostProxy uses **longest-prefix matching**. The route with the most specific (longest) prefix that matches the incoming request path wins.

```
Registered routes:
  /api/v1/users  ->  https://users-service.internal
  /api/v1        ->  https://legacy-monolith.internal

Incoming requests:
  GET /api/v1/users/42     -> matched by /api/v1/users  (more specific)
  GET /api/v1/products/10  -> matched by /api/v1        (fallback)
  GET /api/v2/whatever     -> no match, falls through to 404
```

Routes are reloaded from the database every 15 seconds. New routes become active without a server restart.

---

## Response Headers

GhostProxy adds the following headers to every proxied response:

| Header                | Value                   | Meaning                                         |
| --------------------- | ----------------------- | ----------------------------------------------- |
| `X-Cache`             | `HIT`                   | Response served from LRU cache                  |
| `X-Cache`             | `MISS`                  | Response fetched from upstream API              |
| `RateLimit-Limit`     | number                  | Token bucket capacity for this route            |
| `RateLimit-Remaining` | number                  | Tokens remaining in the current bucket          |
| `Retry-After`         | seconds                 | Time until next token (only on `429` responses) |
| `X-Forwarded-By`      | `observability-wrapper` | Always set on proxied requests                  |

---

## Rate Limiting Behaviour

Rate limits are enforced **per client IP, per route**. A client rate limited on `/api/users` is not affected on `/api/products`.

When the token bucket is exhausted:

```
HTTP 429 Too Many Requests
Retry-After: 3

{ "error": "Rate limit exceeded", "retryAfterMs": 3000 }
```

Idle client buckets (no requests for 5 minutes) are pruned from memory every 60 seconds to prevent unbounded memory growth.

> **Note:** Rate limiting is applied **before** the cache check. Even a cache HIT consumes one token. This prevents clients from using cached responses to probe endpoints at unlimited speed.

---

## Caching Behaviour

- Only `GET` requests are cached. `POST`, `PUT`, `PATCH`, and `DELETE` are always forwarded.
- Responses with status `400` or higher are never stored.
- The cache key is built from: `method + Host header + path + sorted query string`.
- Sorted query params ensure `/items?page=1&sort=asc` and `/items?sort=asc&page=1` share the same cache slot.
- TTL eviction is **lazy** — expiry is checked at read time, not by a background timer. Expired entries are found stale on `get()` or displaced when capacity is hit.

---

## Request Logging

Every request — including cache hits, rate-limited rejections, and upstream errors — is logged to `request_logs` via the batch logger.

The batch logger never blocks the response:

1. Each log entry is appended to an in-memory buffer (~0ms).
2. The buffer is flushed to MySQL every 10 seconds **or** when it reaches 1,000 entries, whichever comes first.
3. On graceful shutdown, the remaining buffer is flushed synchronously before exit.
4. If a flush fails, the batch is re-queued at the front of the buffer and retried on the next cycle.

---

## Graceful Shutdown

Send `SIGTERM` or press `Ctrl+C`. The shutdown sequence is:

1. Stop accepting new HTTP connections
2. Allow in-flight requests to complete
3. Flush the batch logger buffer to MySQL
4. Close the MySQL connection pool
5. Exit with code `0`

If shutdown takes longer than 15 seconds, the process is force-killed with exit code `1`.

---

## Database Schema

### `routes`

Stores all managed route configurations. Updated by the management API. Read by the route registry every 15 seconds.

### `request_logs`

Write-heavy table. Every proxied request is batched and inserted here. Notable design decisions:

- No foreign key on `route_id` — avoids row locks on the `routes` table during bulk inserts.
- `route_prefix` is **denormalized** so analytics queries can filter without a `JOIN`.
- Indexed on `(route_prefix, created_at)`, `(status_code)`, and `(created_at)`.

### `api_keys`

Stores hashed API keys for authenticating management API requests. Not used by the proxy path itself — the proxy is transparent to existing clients.

---

## npm Scripts

| Script            | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `npm run dev`     | Start with `--watch` flag (auto-restart on file change) |
| `npm start`       | Start in production mode                                |
| `npm run migrate` | Run the database migration                              |

---

## Troubleshooting

**`ER_ACCESS_DENIED_ERROR`**
MySQL rejected the credentials. Check your `.env` file: `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT` must all be non-empty. Make sure `.env` is in the project root (same directory as `package.json`), not inside `src/`.

**`No managed route matches`**
You are hitting a path that has not been registered. Use `POST /api/routes` to register it first, or check that your `prefix` starts with `/` and matches the path you are requesting.

**Cache always `MISS`**
Make sure the route has `cache_enabled: true` and you are sending `GET` requests. `POST`, `PUT`, `PATCH`, and `DELETE` are never cached by design. Also check that `cache_ttl_ms` is not `0`.

**Rate limit too aggressive**
Lower `rate_limit_refill_rate` or raise `rate_limit_capacity` for the route via `PATCH /api/routes/:id`. Changes take effect within 15 seconds without a restart.

---

## Tech Stack

| Layer        | Technology                                                         |
| ------------ | ------------------------------------------------------------------ |
| Runtime      | Node.js 18+ (ESM)                                                  |
| Framework    | Express 4                                                          |
| Database     | MySQL 8 via `mysql2/promise`                                       |
| Cache        | Custom LRU (Doubly Linked List + HashMap — no external dependency) |
| Rate Limiter | Custom Token Bucket (virtual scheduling — no external dependency)  |
| Logger       | Buffer-and-Batch with MySQL bulk `INSERT`                          |
| Frontend     | React 19 + Vite + Ant Design + Tailwind _(upcoming)_               |

---

## License

MIT License. Free to use, modify, and distribute.

---

## Stress Testing & Performance

GhostProxy has been stress tested across three dedicated lessons. Every finding below was reproduced, measured, fixed, and re-verified.

---

### Baseline Performance (Lesson 1)

Three distinct baselines were established using [autocannon](https://github.com/mcollina/autocannon).

**Baseline A — Raw ceiling (rate limit disabled)**

Measures pure proxy + LRU cache throughput with no interference.

```
Throughput avg:    2,601 req/s
Throughput peak:   2,891 req/s
Latency p50:       3ms
Latency p99:       7ms
Latency max:       2343ms  (batch logger flush spike - see Lesson 4)
Success rate:      100%
```

**Baseline B — Under attack (capacity 100, refill 10/s)**

Single IP hammering at 2,300 req/s. Rate limiter working correctly.

```
Throughput:        ~20 req/s sustained (burst of 100 then throttled)
Success rate:      1.9%  (rate limiter correctly rejecting the rest)
```

**Baseline C — Realistic traffic (50 req/s paced)**

The honest production baseline. Different IPs at human-speed intervals.

```
Throughput avg:    1,714 req/s
Latency p50:       3ms
Latency p99:       31ms
Latency max:       362ms
Stdev:             10.88ms
Success rate:      100%
```

**Key insight from Baseline comparison:**

The rate limiter is per-IP. In production, 100 different users each get their own bucket of 100 tokens. A single-IP benchmark simulates an attack, not real traffic. Baseline C is the honest production number.

---

### Cache Stampede (Lesson 2)

**The Problem — What Was Discovered**

When 50 concurrent requests arrived simultaneously for a cold cache key:

```
Before fix:   31 upstream calls fired simultaneously
              13 requests timed out (upstream choked)
              clients received 502 Bad Gateway
```

Every concurrent request saw a cache MISS and independently fired an upstream call. The proxy designed to protect the upstream became the weapon attacking it.

**The Fix — Request Coalescing**

An inflight `Map` was added to `cacheManager.js`. When a cache MISS occurs, the first request stores a Promise in the Map before awaiting it. All subsequent concurrent requests for the same key attach to that existing Promise instead of firing their own upstream call.

```
After fix:    1 upstream call for 50 concurrent requests
              0 timeouts
              49 requests coalesced onto the single Promise
```

**New X-Cache header value:** `COALESCED` — a third cache status meaning "I did not use the LRU cache but I also did not call the upstream. I waited on another request's in-flight call."

```
X-Cache: HIT        <- served from LRU memory (<5ms)
X-Cache: MISS       <- designated fetcher, called upstream
X-Cache: COALESCED  <- waited on an in-flight request
```

**Key design decision:** The inflight Map lives in `cacheManager.js`, not `LRUCache.js`. `LRUCache` is a pure data structure that knows nothing about HTTP or Promises. Request coordination belongs in the HTTP-aware layer.

**The coalescing flow:**

```
50 concurrent requests, cold cache

Request 1  -> MISS -> no inflight entry
              calls fetchFn(), stores Promise in Map
              awaits upstream...

Request 2-50 -> MISS -> inflight entry found
                attach to existing Promise
                await same result...

Upstream responds
  -> result stored in LRU cache
  -> inflight Map entry deleted
  -> all 50 waiters receive response simultaneously

Next request arrives -> LRU HIT -> served in <5ms
```

---

### Rate Limiter Accuracy (Lesson 3)

A custom test script (`tests/rateLimiter.test.js`) was written to verify the token bucket gives mathematically exact results under concurrent load.

**The Problem — What Was Discovered**

```
Capacity:          100 tokens
Concurrent load:   500 simultaneous requests
Expected allowed:  100
Actual allowed:    140
Drift:             40 requests (40%)
```

The original `consume()` method updated `lastRefillTime = now` on every single call. Under 500 concurrent requests spanning ~1.4 seconds, each call saw a slightly larger elapsed time than the last and added a fractional token. These fractions accumulated to 40 extra tokens across the full run.

**The Fix**

`lastRefillTime` is now only advanced by the elapsed time that was actually consumed by the refill calculation — not all the way to `Date.now()`. This prevents fractional accumulation across rapid concurrent calls while preserving accurate refills when real time has passed.

**Results after fix:**

```
Test 1 - Cold Bucket Accuracy:      drift 40 -> 3   (Windows clock floor)
Test 2 - Refill Accuracy:           drift 6  -> 0   (mathematically exact)
Test 3 - Bucket Isolation Per IP:   drift 0  -> 0   (unchanged, was correct)
```

**Why drift of 3 is the honest floor on Windows:**

Windows system clock resolution is ~15ms. At 10 tokens/second, a 15ms clock jump adds 0.15 tokens. Across a 456ms test window this produces 2-4 extra tokens. On Linux (1ms clock resolution) drift is 0-1. This is a hardware/OS constraint, not a code bug.

**The three things proven by the test suite:**

```
Test 1: Token count does not drift under simultaneous consumption
Test 2: Refill math is exact - 10 tokens/s * 1s = exactly 10 tokens
Test 3: Buckets are truly isolated - two IPs get fully independent capacity
```

**Running the tests:**

```bash
npm run test:ratelimit
```

---

### Planned: Batch Logger Under Pressure (Lesson 4)

Verify zero log entries are lost when 5,000 requests fire before the flush timer fires. The suspected event loop blocking spike seen in Baseline A (max 2343ms) will be investigated and fixed here.

---

### Planned: Memory Profile (Lesson 5)

Run 50,000 requests and verify the LRU cache memory footprint stays bounded at `LRU_CAPACITY`. No unbounded growth regardless of traffic volume.
