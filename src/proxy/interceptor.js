/**
 * proxy/interceptor.js
 *
 * The central Proxy/Interceptor middleware.
 *
 * Design: Chain of Responsibility + Decorator Pattern.
 *
 * A request passes through a pipeline of concerns in a fixed order:
 *   1. Route matching       - Is this request managed by us?
 *   2. Rate limiting        - Is the client allowed to proceed?
 *   3. Cache check          - Do we have a stored response?
 *   4. Upstream forwarding  - Forward to the real API and capture the response.
 *   5. Cache population     - Store the upstream response for next time.
 *   6. Logging              - Hand the completed request data to the logger.
 *
 * Each step is a decorator on the request. The upstream API is unaware of any
 * of this. This is the "sidecar" pattern - we add capabilities without
 * modifying the wrapped system.
 *
 * WHY NOT USE http-proxy-middleware DIRECTLY?
 * http-proxy-middleware is great for simple forwarding but it sends the
 * response to the client as a stream before we can inspect it. We need to
 * intercept the response body to store it in the cache. So we use Node's
 * built-in http/https module to make the upstream request ourselves,
 * giving us full control over the response before we send it.
 */

import http from "http";
import https from "https";
import { URL } from "url";
import { matchRoute } from "./routeRegistry.js";
import { getOrFetch } from "../cache/cacheManager.js";
import { consumeToken } from "../ratelimiter/tokenBucket.js";
import { log } from "../logger/batchLogger.js";

/**
 * Extracts the real client IP from the request.
 * Handles cases where the proxy is behind a load balancer that sets X-Forwarded-For.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Makes an HTTP/HTTPS request to the upstream and returns the full response.
 * We buffer the response body so we can: a) cache it, b) measure its size,
 * and c) relay it to the client with proper headers.
 *
 * @param {object} options - Node http.request options
 * @param {Buffer|null} body - The original request body to forward (for POST/PUT)
 * @returns {Promise<{ statusCode: number, headers: object, body: Buffer }>}
 */
function forwardRequest(options, body) {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === "https:" ? https : http;

    const upstreamReq = transport.request(options, (upstreamRes) => {
      const chunks = [];

      upstreamRes.on("data", (chunk) => chunks.push(chunk));

      upstreamRes.on("end", () => {
        resolve({
          statusCode: upstreamRes.statusCode,
          headers: upstreamRes.headers,
          body: Buffer.concat(chunks),
        });
      });

      upstreamRes.on("error", reject);
    });

    upstreamReq.on("error", reject);

    // Set a timeout so a hung upstream does not hold a connection open forever.
    upstreamReq.setTimeout(15000, () => {
      upstreamReq.destroy(new Error("Upstream request timed out after 15s"));
    });

    if (body && body.length > 0) {
      upstreamReq.write(body);
    }

    upstreamReq.end();
  });
}

/**
 * Express middleware that intercepts all requests and runs the
 * cache -> rate-limit -> proxy pipeline.
 *
 * Requests that match a registered route are handled here.
 * Requests that do not match fall through to next() (management API routes).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function interceptor(req, res, next) {
  const route = matchRoute(req.path);

  // Not a managed route. Pass to the next Express handler (management API).
  if (!route) {
    return next();
  }

  const startTime = Date.now();
  const clientIp = getClientIp(req);

  let cacheHit = false;
  let rateLimited = false;

  try {
    // STEP 1: Rate limiting.
    // Run before cache check so even cached responses count against the limit.
    // This prevents a client from hammering the cache to mine analytics or
    // probe endpoint existence.
    if (route.rate_limit_enabled) {
      const result = consumeToken(clientIp, route.prefix, route);

      // Set standard rate-limit headers regardless of outcome.
      // These are the de-facto standard (RateLimit-* headers, RFC 6585 draft).
      res.set("RateLimit-Limit", route.rate_limit_capacity);
      res.set("RateLimit-Remaining", result.remaining);

      if (!result.allowed) {
        rateLimited = true;
        res.set("Retry-After", Math.ceil(result.resetAfterMs / 1000));

        // Log the rejected request before returning.
        log({
          route_id: route.id,
          route_prefix: route.prefix,
          method: req.method,
          path: req.path,
          status_code: 429,
          duration_ms: Date.now() - startTime,
          cache_hit: false,
          rate_limited: true,
          client_ip: clientIp,
          request_size_bytes: Number(req.headers["content-length"] || 0),
          response_size_bytes: 0,
        });

        return res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterMs: result.resetAfterMs,
        });
      }
    }

    // STEP 2 + 3 + 4: Cache check, coalescing, upstream forward, and cache store.
    //
    // These three steps are now handled by a single getOrFetch() call.
    // This eliminates the Cache Stampede problem by ensuring only one upstream
    // call fires per unique resource, regardless of concurrent request count.
    //
    // getOrFetch() returns three possible states:
    // - fromCache: true   -> LRU HIT, served from memory
    // - coalesced: true   -> another request was already in-flight, we waited
    //                        for its result instead of firing our own call
    // - both false        -> we were the designated fetcher, result is fresh
    //
    // The fetchFn callback is only called if getOrFetch decides a real upstream
    // call is needed. cacheManager never knows how to talk to the upstream -
    // that knowledge stays in the interceptor.

    // Build the upstream request body and options outside fetchFn so they are
    // only constructed once regardless of whether fetchFn is actually called.
    let requestBody;

    if (req.body && Object.keys(req.body).length > 0) {
      requestBody = Buffer.from(JSON.stringify(req.body));
    } else if (req.readable) {
      requestBody = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
    } else {
      requestBody = Buffer.alloc(0);
    }

    const upstreamBase = new URL(route.upstream_url);
    const forwardedPath = req.path.replace(route.prefix, "") || "/";
    const queryString = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";

    const upstreamOptions = {
      protocol: upstreamBase.protocol,
      hostname: upstreamBase.hostname,
      port:
        upstreamBase.port || (upstreamBase.protocol === "https:" ? 443 : 80),
      path: forwardedPath + queryString,
      method: req.method,
      headers: {
        ...req.headers,
        host: upstreamBase.hostname,
        "x-forwarded-by": "observability-wrapper",
        "x-forwarded-for": clientIp,
      },
    };
    const response = await getOrFetch(
      req,
      async () => {
        console.log(
          "[Stampede-Test] Cache MISS - upstream call starting for:",
          req.path,
        );
        const result = await forwardRequest(upstreamOptions, requestBody);
        console.log(
          "[Stampede-Test] Upstream response received for:",
          req.path,
        );
        return result;
      },
      route.cache_enabled ? route.cache_ttl_ms : null,
    );

    // Determine the X-Cache header value based on how the response was served.
    // HIT        -> served from LRU cache
    // COALESCED  -> waited on an in-flight request, no upstream call made
    // MISS       -> we made the upstream call ourselves
    let cacheStatus = "MISS";
    if (response.fromCache) {
      cacheStatus = "HIT";
      cacheHit = true;
    } else if (response.coalesced) {
      cacheStatus = "COALESCED";
    }

    // STEP 5: Send response to client.
    const {
      connection,
      "transfer-encoding": te,
      ...safeHeaders
    } = response.headers;
    res.set(safeHeaders);
    res.set("X-Cache", cacheStatus);
    res.status(response.statusCode).send(response.body);

    // STEP 6: Log the completed request (non-blocking).
    log({
      route_id: route.id,
      route_prefix: route.prefix,
      method: req.method,
      path: req.path,
      status_code: response.statusCode,
      duration_ms: Date.now() - startTime,
      cache_hit: response.fromCache || response.coalesced,
      rate_limited: false,
      client_ip: clientIp,
      request_size_bytes: requestBody.length,
      response_size_bytes: response.body.length,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(
      `[Interceptor] Error proxying ${req.method} ${req.path}:`,
      err.message,
    );

    log({
      route_id: route.id,
      route_prefix: route.prefix,
      method: req.method,
      path: req.path,
      status_code: 502,
      duration_ms: duration,
      cache_hit: cacheHit,
      rate_limited: rateLimited,
      client_ip: clientIp,
      request_size_bytes: 0,
      response_size_bytes: 0,
    });

    if (!res.headersSent) {
      res.status(502).json({ error: "Bad Gateway", message: err.message });
    }
  }
}

export { interceptor };
