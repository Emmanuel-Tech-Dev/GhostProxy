/**
 * routes/analyticsApi.js
 *
 * Analytics endpoints that power the dashboard.
 *
 * Design: All heavy aggregation happens in MySQL, not in Node.
 * MySQL is optimized for GROUP BY queries over large datasets. Pulling all
 * rows into Node and aggregating in JS would use far more memory and time.
 * The indexes we defined in the migration (route_prefix, created_at) make
 * these queries fast even with millions of log rows.
 */

import { Router } from "express";
import pool from "./pool.js";
import { getCacheMetrics } from "./cacheManager.js";
import { getBucketStoreSize } from "./tokenBucket.js";

const router = Router();

/**
 * GET /api/analytics/overview
 *
 * High-level summary for the dashboard header cards:
 * - Total requests in the last 24h
 * - Cache hit rate in the last 24h
 * - Rate-limited request count in the last 24h
 * - P95 latency in the last 24h
 * - Error rate (4xx + 5xx) in the last 24h
 */
router.get("/overview", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*)                                         AS total_requests,
        SUM(cache_hit)                                   AS cache_hits,
        SUM(rate_limited)                                AS rate_limited_count,
        ROUND(AVG(duration_ms), 2)                       AS avg_latency_ms,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
        SUM(response_size_bytes)                         AS total_bytes_served
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL 24 HOUR
    `);

    const summary = rows[0];
    const cacheMetrics = getCacheMetrics();

    res.json({
      success: true,
      data: {
        ...summary,
        cache_hit_rate_pct:
          summary.total_requests > 0
            ? ((summary.cache_hits / summary.total_requests) * 100).toFixed(2)
            : "0.00",
        error_rate_pct:
          summary.total_requests > 0
            ? ((summary.error_count / summary.total_requests) * 100).toFixed(2)
            : "0.00",
        lru_cache: cacheMetrics,
        active_rate_limit_buckets: getBucketStoreSize(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/requests-over-time
 *
 * Request volume bucketed by time interval for the main chart.
 * Query param: interval = "minute" | "hour" | "day" (default: "hour")
 * Query param: hours = number of hours to look back (default: 24)
 */
router.get("/requests-over-time", async (req, res) => {
  const interval = ["minute", "hour", "day"].includes(req.query.interval)
    ? req.query.interval
    : "hour";
  const hours = Math.min(Number(req.query.hours) || 24, 720); // Cap at 30 days.

  // DATE_FORMAT strings for grouping by different intervals.
  const formatMap = {
    minute: "%Y-%m-%d %H:%i:00",
    hour: "%Y-%m-%d %H:00:00",
    day: "%Y-%m-%d 00:00:00",
  };

  try {
    const [rows] = await pool.query(
      `
      SELECT
        DATE_FORMAT(created_at, ?) AS bucket,
        COUNT(*)                   AS total,
        SUM(cache_hit)             AS cache_hits,
        SUM(rate_limited)          AS rate_limited,
        ROUND(AVG(duration_ms), 2) AS avg_latency_ms,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
      [formatMap[interval], hours],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/by-route
 *
 * Per-route breakdown: request count, error rate, cache hit rate, avg latency.
 * Useful for comparing which routes are hot, slow, or error-prone.
 */
router.get("/by-route", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);

  try {
    const [rows] = await pool.query(
      `
      SELECT
        route_prefix,
        COUNT(*)                                         AS total_requests,
        SUM(cache_hit)                                   AS cache_hits,
        ROUND(SUM(cache_hit) / COUNT(*) * 100, 2)        AS cache_hit_rate_pct,
        SUM(rate_limited)                                AS rate_limited_count,
        ROUND(AVG(duration_ms), 2)                       AS avg_latency_ms,
        MIN(duration_ms)                                 AS min_latency_ms,
        MAX(duration_ms)                                 AS max_latency_ms,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
        ROUND(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS error_rate_pct
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY route_prefix
      ORDER BY total_requests DESC
    `,
      [hours],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/status-codes
 *
 * Distribution of HTTP status codes. Helps spot whether errors are
 * client-side (4xx) or upstream (5xx).
 */
router.get("/status-codes", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);

  try {
    const [rows] = await pool.query(
      `
      SELECT
        status_code,
        COUNT(*) AS count,
        ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 2) AS percentage
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY status_code
      ORDER BY count DESC
    `,
      [hours],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/top-clients
 *
 * Top client IPs by request volume. Useful for spotting abusive clients
 * even before they hit the rate limit.
 */
router.get("/top-clients", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const [rows] = await pool.query(
      `
      SELECT
        client_ip,
        COUNT(*)          AS total_requests,
        SUM(rate_limited) AS times_rate_limited,
        ROUND(AVG(duration_ms), 2) AS avg_latency_ms,
        MAX(created_at)   AS last_seen
      FROM request_logs
      WHERE created_at >= NOW() - INTERVAL ? HOUR
        AND client_ip IS NOT NULL
      GROUP BY client_ip
      ORDER BY total_requests DESC
      LIMIT ?
    `,
      [hours, limit],
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/recent-logs
 *
 * Paginated raw log tail for the "Live Logs" section of the dashboard.
 */
router.get("/recent-logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const routePrefix = req.query.route_prefix || null;

  try {
    const conditions = ["1 = 1"];
    const params = [];

    if (routePrefix) {
      conditions.push("route_prefix = ?");
      params.push(routePrefix);
    }

    params.push(limit, offset);

    const [rows] = await pool.query(
      `
      SELECT id, route_prefix, method, path, status_code, duration_ms,
             cache_hit, rate_limited, client_ip, created_at
      FROM request_logs
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
      params,
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
