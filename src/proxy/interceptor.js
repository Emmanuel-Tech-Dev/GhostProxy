import http from "http";
import https from "https";
import { URL } from "url";
import { matchRoute } from "./routeRegistry.js";
import { getOrFetch } from "../cache/cacheManager.js";
import { consumeToken } from "../ratelimiter/tokenBucket.js";
import { log } from "../logger/batchLogger.js";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function forwardRequest(options, body) {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === "https:" ? https : http;

    const upstreamReq = transport.request(options, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () =>
        resolve({
          statusCode: upstreamRes.statusCode,
          headers: upstreamRes.headers,
          body: Buffer.concat(chunks),
        }),
      );
      upstreamRes.on("error", reject);
    });

    upstreamReq.on("error", reject);

    upstreamReq.setTimeout(15000, () => {
      upstreamReq.destroy(new Error("Upstream request timed out after 15s"));
    });

    if (body && body.length > 0) upstreamReq.write(body);
    upstreamReq.end();
  });
}

async function interceptor(req, res, next) {
  const route = matchRoute(req.path);
  if (!route) return next();

  const startTime = Date.now();
  const clientIp = getClientIp(req);
  let rateLimited = false;

  try {
    // Rate limiting
    if (route.rate_limit_enabled) {
      const result = consumeToken(clientIp, route.prefix, route);

      res.set("RateLimit-Limit", route.rate_limit_capacity);
      res.set("RateLimit-Remaining", result.remaining);

      if (!result.allowed) {
        rateLimited = true;
        res.set("Retry-After", Math.ceil(result.resetAfterMs / 1000));

        log({
          user_id: route.user_id,
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

    // Collect request body
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

    // Build upstream request options
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
        "x-forwarded-by": "ghostproxy",
        "x-forwarded-for": clientIp,
      },
    };

    // Cache + coalescing + upstream forward
    const response = await getOrFetch(
      req,
      () => forwardRequest(upstreamOptions, requestBody),
      route.cache_enabled ? route.cache_ttl_ms : null,
    );

    let cacheStatus = "MISS";
    if (response.fromCache) cacheStatus = "HIT";
    if (response.coalesced) cacheStatus = "COALESCED";

    const {
      connection,
      "transfer-encoding": te,
      ...safeHeaders
    } = response.headers;
    res.set(safeHeaders);
    res.set("X-Cache", cacheStatus);
    res.status(response.statusCode).send(response.body);

    log({
      user_id: route.user_id,
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
    console.error(`[Interceptor] ${req.method} ${req.path}:`, err.message);

    log({
      user_id: route.user_id,
      route_id: route.id,
      route_prefix: route.prefix,
      method: req.method,
      path: req.path,
      status_code: 502,
      duration_ms: Date.now() - startTime,
      cache_hit: false,
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
