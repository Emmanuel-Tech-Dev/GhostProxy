# GHOSTPROXY
### Smart Observability Wrapper
> Add Caching, Analytics, and Rate-Limiting to any API in 60 seconds.

---

## What Is GhostProxy?

GhostProxy is a Node.js sidecar proxy that sits transparently in front of any existing HTTP API. It adds caching, rate-limiting, analytics, and a full management dashboard to APIs you cannot or do not want to modify. Point your clients at GhostProxy instead of the original API, register your routes once, and every request is automatically observed, cached, and rate-limited.

> **Why it exists:** Many companies have legacy or black-box APIs that are slow, have no observability, and lack rate-limiting. Replacing them is expensive. GhostProxy upgrades them without touching a single line of the original codebase.

---

## System Architecture

Every request passes through a fixed, ordered pipeline. Each stage is independent and can be enabled or disabled per route.

```
Client Request
     |
     v
+----------------------+
|  Auth Middleware     |  JWT verification. Attaches req.user.
+----------------------+
     |
     v
+----------------------+
|  Route Registry      |  matchRoute() — longest prefix wins.
|                      |  Loaded from MySQL, polled every 15s.
+----------------------+
     |  matched
     v
+----------------------+
|  Token Bucket        |  Per-IP rate limiter. 429 if exhausted.
|  Rate Limiter        |  Virtual scheduling, zero background work.
+----------------------+
     |  allowed
     v
+----------------------+
|  LRU Cache           |  O(1) get. Returns <5ms on HIT.
|  + Inflight Map      |  Request coalescing prevents stampede.
+----------------------+
     |  MISS
     v
+----------------------+
|  Upstream Proxy      |  Forwards to real API. Captures response.
+----------------------+
     |
     v
+----------------------+
|  Cache Store         |  PUT response for next request.
+----------------------+
     |
     v
+----------------------+
|  Batch Logger        |  Buffer entry. Flush every 10s or 1000 reqs.
+----------------------+
     |
     v
Response to Client
```

---

## Design Patterns & Why

Every architectural decision is deliberate.

### Proxy / Interceptor Pattern

The interceptor middleware sits between client and upstream. It is the Decorator Pattern at the network level — capabilities are added without modifying the wrapped system. The upstream API has zero awareness of GhostProxy's existence.

### LRU Cache — Doubly Linked List + HashMap

Built from scratch rather than a library to give full control over TTL eviction and metric reporting.

- **HashMap** gives O(1) key lookup.
- **Doubly Linked List** gives O(1) promotion on hit and O(1) eviction at tail.
- A plain `Map` gives insertion-order but not recency — that is why the DLL is needed.

TTL is checked lazily at read time. No background timer. Expired entries are displaced by new ones or found stale on the next `get()`.

### Request Coalescing — Cache Stampede Prevention

An inflight `Map` in `cacheManager.js` ensures only one upstream call fires per unique resource regardless of how many concurrent requests arrive simultaneously. All concurrent waiters attach to the same Promise and share the single response. Verified under stress testing — 50 concurrent requests on a cold cache reduced from 31 upstream calls to exactly 1.

Three X-Cache states:
```
X-Cache: HIT        served from LRU memory (<5ms)
X-Cache: MISS       designated fetcher, called upstream
X-Cache: COALESCED  waited on another request's in-flight call
```

### Token Bucket Rate Limiter

Token Bucket was chosen over Fixed Window and Sliding Window.

- **Fixed Window** has the thundering herd problem — a client can double burst capacity at window boundaries.
- **Sliding Window** requires storing a timestamp per request — memory-intensive at high traffic.
- **Token Bucket** allows controlled bursts while enforcing a long-term average rate. Refill uses virtual scheduling: tokens are calculated lazily at `consume()` time using `(elapsedSeconds * refillRate)`, so zero background work is required.

Rate limits are per-IP, per-route. A client rate-limited on `/proxy/users` is unaffected on `/proxy/orders`.

### Buffer-and-Batch Logger — Producer / Consumer

Writing one MySQL `INSERT` per request is synchronous with the request lifecycle. Under load this adds 1–5ms of DB latency to every response.

The batch logger decouples the hot path from the DB. `log()` appends to an in-memory array in ~0ms. A background interval flushes all buffered rows in a single multi-row `INSERT` every 10 seconds or 1,000 entries. An atomic buffer swap before the INSERT ensures no log entry is duplicated or lost. On flush failure the batch is re-queued at the front of the buffer for retry.

### JWT + Refresh Token Auth

Access tokens are short-lived (15 min) and stateless — verified with the JWT secret, no DB lookup needed. Refresh tokens are long-lived (7 days), stored as SHA256 hashes in MySQL, and rotated on every use. If a refresh token is used after rotation, it is rejected. On logout all refresh tokens for the user are revoked.

The frontend stores the access token in memory only — never in localStorage. The refresh token lives in an httpOnly cookie, making it inaccessible to JavaScript and immune to XSS.

### Registry Pattern — Route Registry

Routes are loaded from MySQL at startup into an in-memory `Map` sorted by prefix length DESC. The proxy reads this map on every request, not the database. An atomic swap on reload means in-flight requests use the old map until the new one is fully built. A 15-second poll picks up route changes without requiring a server restart.

### Single Responsibility Modules

`LRUCache` knows nothing about HTTP. The interceptor knows about HTTP but nothing about linked lists. The batch logger knows about buffering but not about routes. Each module has exactly one reason to change.

---

## Project Structure

```
GhostProxy/
  src/                              Backend
    auth/
      authController.js             register, login, refresh, logout, me
      authMiddleware.js             requireAuth, optionalAuth
      tokenService.js               JWT sign, verify, rotate, revoke
    cache/
      LRUCache.js                   Raw data structure (DLL + HashMap)
      cacheManager.js               HTTP-aware wrapper + inflight Map
    db/
      migrate.js                    Schema DDL runner
      pool.js                       MySQL connection pool singleton
    logger/
      batchLogger.js                Buffer-and-batch producer/consumer
    middleware/
      errorHandler.js               Central error shape
    proxy/
      interceptor.js                Core middleware (chain of responsibility)
      routeRegistry.js              Route config loader and watcher
    ratelimiter/
      tokenBucket.js                Token Bucket algorithm + BucketStore
    routes/
      accountApi.js                 Profile and password update
      analyticsApi.js               Dashboard analytics queries
      apiKeysApi.js                 API key generation and management
      authApi.js                    Auth endpoints
      routesApi.js                  Proxy route CRUD
    server.js                       Entry point
  tests/
    rateLimiter.test.js             Rate limiter accuracy test suite
  ui/                        Frontend
    src/
      api/
        auth.js
        analytics.js
        client.js                   Axios instance + interceptors
        routes.js
      components/
        layout/
          AppLayout.jsx
          Header.jsx
          Sidebar.jsx
        shared/
          LogTable.jsx
          StatCard.jsx
          StatusBadge.jsx
      config/
        settings.js
      pages/
        Analytics.jsx
        Dashboard.jsx
        Logs.jsx
        Login.jsx
        Register.jsx
        Routes.jsx
        Settings.jsx
      store/
        authStore.js                Zustand store with theme persistence
      App.jsx
      main.jsx
    .env
    package.json
    vite.config.js
  package.json                      Backend
  .env
  .env.example
  README.md
```

---

## Prerequisites

- Node.js 18 or higher (ESM modules required)
- MySQL 8.0 or higher
- npm 9 or higher

---

## Backend Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | Proxy server port | `4000` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL username | — |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | Database name | `ghostproxy` |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens | — |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | — |
| `JWT_ACCESS_TTL` | Access token expiry | `15m` |
| `JWT_REFRESH_TTL_MS` | Refresh token expiry in ms | `604800000` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `LRU_CAPACITY` | Max cache entries | `500` |
| `LRU_TTL_MS` | Global cache TTL in ms | `30000` |
| `RATE_LIMIT_CAPACITY` | Token bucket burst ceiling | `100` |
| `RATE_LIMIT_REFILL_RATE` | Tokens added per second | `10` |
| `LOG_BUFFER_MAX_SIZE` | Flush when buffer hits this size | `1000` |
| `LOG_FLUSH_INTERVAL_MS` | Flush every N ms | `10000` |

Generate JWT secrets:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Run twice — once for each secret. Use different values.

### 3. Run the migration

```bash
node src/db/migrate.js
```

Creates: `users`, `refresh_tokens`, `routes`, `request_logs`, `api_keys`.

### 4. Start the server

```bash
npm run dev    # development with auto-restart
npm start      # production
```

---

## Frontend Setup

```bash
cd dashboard
npm install
cp .env.example .env   # set VITE_API_URL=http://localhost:4000
npm run dev
```

Dashboard runs on `http://localhost:5173`.

---

## Quick Start

### 1. Create an account

```bash
POST http://localhost:4000/auth/register
{
  "email": "you@example.com",
  "password": "yourpassword"
}
```

### 2. Register a proxy route

```bash
POST http://localhost:4000/api/routes
Authorization: Bearer <access_token>
{
  "name": "JSONPlaceholder",
  "prefix": "/proxy",
  "upstream_url": "https://jsonplaceholder.typicode.com",
  "cache_enabled": true,
  "cache_ttl_ms": 30000,
  "rate_limit_enabled": true,
  "rate_limit_capacity": 100,
  "rate_limit_refill_rate": 10
}
```

### 3. Use the proxy

```bash
# Before — hitting the real API directly
GET https://jsonplaceholder.typicode.com/users/1

# After — hitting GhostProxy (zero changes to the upstream)
GET http://localhost:4000/proxy/users/1
```

First request returns `X-Cache: MISS` — forwarded upstream.
Second request returns `X-Cache: HIT` — served from LRU in under 5ms.

---

## API Reference

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | None | Create account |
| `POST` | `/auth/login` | None | Sign in |
| `POST` | `/auth/refresh` | Cookie | Rotate refresh token |
| `POST` | `/auth/logout` | JWT | Revoke all refresh tokens |
| `GET` | `/auth/me` | JWT | Get current user |

### Routes Management

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/routes` | List all routes |
| `GET` | `/api/routes/:id` | Get single route |
| `POST` | `/api/routes` | Register new route |
| `PATCH` | `/api/routes/:id` | Update route |
| `DELETE` | `/api/routes/:id` | Delete route |

### Analytics

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/analytics/overview` | 24h summary stats |
| `GET` | `/api/analytics/requests-over-time` | Volume by time bucket. Params: `interval`, `hours` |
| `GET` | `/api/analytics/by-route` | Per-route breakdown |
| `GET` | `/api/analytics/status-codes` | Status code distribution |
| `GET` | `/api/analytics/top-clients` | Top IPs by volume |
| `GET` | `/api/analytics/recent-logs` | Paginated log tail |

### Account

| Method | Endpoint | Description |
|---|---|---|
| `PATCH` | `/api/account` | Update profile |
| `PATCH` | `/api/account/password` | Change password |

### API Keys

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/keys` | List all keys |
| `POST` | `/api/keys` | Generate new key |
| `DELETE` | `/api/keys/:id` | Delete key |

### Other

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |

---

## Route Matching

GhostProxy uses longest-prefix matching. The most specific prefix wins.

```
Registered routes:
  /proxy/users  ->  https://users-service.internal
  /proxy        ->  https://legacy-monolith.internal

Incoming requests:
  GET /proxy/users/42     -> matched by /proxy/users  (more specific)
  GET /proxy/products/10  -> matched by /proxy         (fallback)
  GET /v2/whatever        -> no match, 404
```

The upstream receives the path with the prefix stripped:
```
Final upstream URL = upstream_url + (request path - prefix)

/proxy/users/42 with upstream https://api.example.com/users
  strips /proxy/users, appends /42
  forwards to https://api.example.com/users/42
```

---

## Response Headers

| Header | Value | Meaning |
|---|---|---|
| `X-Cache` | `HIT` | Served from LRU memory |
| `X-Cache` | `MISS` | Fetched from upstream |
| `X-Cache` | `COALESCED` | Waited on another in-flight request |
| `RateLimit-Limit` | number | Bucket capacity |
| `RateLimit-Remaining` | number | Tokens remaining |
| `Retry-After` | seconds | Time until next token (429 only) |
| `X-Forwarded-By` | `ghostproxy` | Always set on proxied requests |

---

## Authentication Architecture

### Two-Token Pattern

```
Access Token   short-lived (15 min)
               stateless JWT — no DB lookup on verify
               stored in memory only (Zustand store)
               sent as Authorization: Bearer <token>

Refresh Token  long-lived (7 days)
               SHA256 hashed in MySQL
               httpOnly cookie — inaccessible to JavaScript
               rotated on every use (single-use)
               revoked on logout and password change
```

### Silent Token Refresh

The axios client response interceptor catches 401s, calls `/auth/refresh` via the httpOnly cookie, updates the Zustand store, and retries the original request. The user never sees the expiry.

On page load, `App.jsx` calls `/auth/refresh` once to restore the session. If the cookie is valid the user is logged in silently. If not, the login page renders.

### Security Decisions

```
Passwords          bcrypt cost factor 12 (~250ms)
Email enumeration  same error for wrong email and wrong password
                   constant-time comparison prevents timing attacks
Refresh tokens     SHA256 hashed before storage
                   raw token shown once, never stored
API keys           same SHA256 hashing pattern
                   type separation: management vs proxy
```

---

## Multi-Tenant Architecture

GhostProxy is self-hosted and single-tenant per installation, with the architecture ready for cloud multi-tenancy.

Every table carries `user_id`. Every management API query is scoped to `req.user.id`. User A cannot see or modify User B's data — enforced at the application layer on every query.

### Tenant Identification — Design Decision

Three options were evaluated for cloud multi-tenant proxy path identification:

```
Option A  Key in URL prefix     /pk_abc123/proxy/users
          Simple, no client changes
          Con: key exposed in server logs and browser history

Option B  Subdomain routing     alice.ghostproxy.com/proxy/users
          Transparent to clients, nothing sensitive in URL
          Con: requires DNS infrastructure

Decision  Self-hosted single-tenant now
          Subdomain routing added in Phase 5 (cloud)
          user_id already on every table — no schema rework needed
```

### Roadmap

```
Phase 1   Auth foundation                     COMPLETE
Phase 2   Multi-tenant proxy path             COMPLETE
Phase 3   React dashboard                     COMPLETE
Phase 4   Docker + CLI setup wizard           planned
Phase 5   Cloud hosting + subdomain routing   planned
          Stripe billing                      planned
          Managed MySQL + Redis               planned
```

---

## Dashboard

Built with React 19, Vite, Ant Design 5, Tailwind CSS 4, TanStack Query v5, Zustand, and Recharts.

### Pages

| Page | Description |
|---|---|
| `/dashboard` | Overview cards, request volume chart, system health, recent logs |
| `/routes` | Route management — create, edit, toggle active/inactive, delete |
| `/logs` | Live log tail with route filter, auto-refreshes every 10 seconds |
| `/analytics` | Per-route breakdown, status code distribution pie chart, top clients |
| `/settings` | Profile update, password change, API key generation and management |

### Features

- Dark and light mode toggle, preference persisted across page refreshes via Zustand persist middleware
- Silent session restore on page load via httpOnly refresh token cookie
- Auto token refresh on 401 — no manual re-login when access token expires
- All data scoped to the authenticated user

---

## Stress Testing & Performance

### Baseline Performance (Lesson 1)

**Baseline A — Raw ceiling (rate limit disabled)**
```
Throughput avg:    2,601 req/s
Throughput peak:   2,891 req/s
Latency p50:       3ms
Latency p99:       7ms
Latency max:       2343ms
Success rate:      100%
```

**Baseline B — Under attack (capacity 100, refill 10/s)**
```
Throughput:        ~20 req/s sustained
Success rate:      1.9%  (rate limiter correctly rejecting the rest)
```

**Baseline C — Realistic traffic (50 req/s paced)**
```
Throughput avg:    1,714 req/s
Latency p50:       3ms
Latency p99:       31ms
Latency max:       362ms
Success rate:      100%
```

The rate limiter is per-IP. Baseline B simulates a DDoS from a single IP. Baseline C is the honest production number — different IPs at realistic intervals.

---

### Cache Stampede (Lesson 2)

**Problem:** 50 concurrent requests on a cold cache fired 31 simultaneous upstream calls. 13 timed out. Clients received 502.

**Root cause:** No coordination between concurrent requests. All saw MISS simultaneously and all went upstream independently.

**Fix — Request Coalescing:** The first MISS stores a Promise in an inflight Map before awaiting it. All subsequent concurrent requests attach to the existing Promise. After fix: 1 upstream call for 50 requests, 0 timeouts.

---

### Rate Limiter Accuracy (Lesson 3)

**Problem:** 500 concurrent requests against a 100-token bucket allowed 140 through — 40 token drift.

**Root cause:** `lastRefillTime = now` on every `consume()` call caused fractional token accumulation across concurrent calls.

**Fix:** `lastRefillTime` advances only by the elapsed time consumed by the refill calculation, not all the way to `Date.now()`.

**Results after fix:**
```
Cold bucket accuracy:   drift 40 -> 3  (Windows clock floor, irreducible)
Refill accuracy:        drift 6  -> 0  (mathematically exact)
Bucket isolation:       drift 0  -> 0  (unchanged, was always correct)
```

**Running the tests:**
```bash
npm run test:ratelimit
```

---

### Planned: Batch Logger Under Pressure (Lesson 4)

Verify zero log entries are lost when 5,000 requests fire before the flush timer fires. The 2343ms max latency spike in Baseline A is suspected to be event loop blocking from the batch flush — to be investigated and fixed.

---

### Planned: Memory Profile (Lesson 5)

Run 50,000 requests and verify the LRU cache memory footprint stays bounded at `LRU_CAPACITY` regardless of traffic volume.

---

## Database Schema

### `users`
Core identity table. `plan_tier` reserved for cloud phase — self-hosted users are always `self_hosted`.

### `refresh_tokens`
SHA256-hashed refresh tokens with expiry timestamps. Supports rotation, full revocation, and automatic cleanup of expired rows.

### `routes`
Proxy route configurations scoped by `user_id`. Unique on `(user_id, prefix)` — two users can use the same prefix independently.

### `request_logs`
Write-heavy log table. No FK on `user_id` to avoid row locks during bulk inserts. `route_prefix` denormalized for analytics queries. Indexed on `(user_id, route_prefix, created_at)`.

### `api_keys`
Hashed API keys with `management` and `proxy` type separation. Raw key shown once, never stored. `key_prefix` stored in plain for dashboard identification.

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start backend with `--watch` |
| `npm start` | Start backend in production |
| `npm run migrate` | Run database migration |
| `npm run test:ratelimit` | Run rate limiter accuracy tests |

---

## Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (ESM) |
| Framework | Express 4 |
| Database | MySQL 8 via `mysql2/promise` |
| Auth | `jsonwebtoken` + `bcrypt` |
| Cache | Custom LRU — Doubly Linked List + HashMap |
| Rate Limiter | Custom Token Bucket — virtual scheduling |
| Logger | Buffer-and-Batch with MySQL bulk INSERT |

### Frontend

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite |
| UI | Ant Design 5 |
| Styling | Tailwind CSS 4 |
| Data Fetching | TanStack React Query v5 |
| State | Zustand v4 |
| Charts | Recharts |
| Routing | React Router v6 |
| HTTP | Axios 0.27.2 |

---

## Troubleshooting

**`ER_ACCESS_DENIED_ERROR`**
Check `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` in `.env`. Ensure `.env` is in the project root.

**`No managed route matches`**
Register the route via `POST /api/routes`. Confirm `prefix` starts with `/`.

**`Cache always MISS`**
Confirm `cache_enabled: true` and that requests are `GET`. `POST`, `PUT`, `PATCH`, `DELETE` are never cached.

**`Rate limit too aggressive`**
Update `rate_limit_capacity` and `rate_limit_refill_rate` via `PATCH /api/routes/:id`. Takes effect within 15 seconds.

**`401 on refresh at startup`**
Expected on a fresh install — no cookie exists yet. Register an account to create a session.

**`CORS errors in browser`**
Confirm `CORS_ORIGIN` in backend `.env` matches the exact frontend origin including port. Default: `http://localhost:5173`.

---

## License

MIT License. Free to use, modify, and distribute.
