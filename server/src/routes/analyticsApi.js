/**
 * routes/analyticsApi.js
 *
 * Analytics endpoints scoped to the authenticated user.
 * Every query filters by req.user.id - a user can only see their own data.
 */

import { Router } from "express";
import pool from "../db/pool.js";
import { getCacheMetrics } from "../cache/cacheManager.js";
import { getBucketStoreSize } from "../ratelimiter/tokenBucket.js";

const router = Router();

// GET /api/analytics/overview
router.get("/overview", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         COUNT(*)                                              AS total_requests,
         SUM(cache_hit)                                        AS cache_hits,
         SUM(rate_limited)                                     AS rate_limited_count,
         ROUND(AVG(duration_ms), 2)                           AS avg_latency_ms,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)  AS error_count,
         SUM(response_size_bytes)                              AS total_bytes_served
       FROM request_logs
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL 24 HOUR`,
      [req.user.id],
    );

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
// GET /api/analytics/requests-over-time
router.get("/requests-over-time", async (req, res) => {
  const interval = ["minute", "hour", "day", "week", "month", "all"].includes(
    req.query.interval,
  )
    ? req.query.interval
    : "hour";
  const hours = Math.min(Number(req.query.hours) || 24, 720, 3600);

  const formatMap = {
    minute: "%Y-%m-%d %H:%i:00",
    hour: "%Y-%m-%d %H:00:00",
    day: "%Y-%m-%d 00:00:00",
    week: "%Y-%m-%d 00:00:00",
    month: "%Y-%m-01 00:00:00",
    all: "%Y-%m-%d 00:00:00",
  };

  try {
    let query = `SELECT
         DATE_FORMAT(created_at, ?) AS bucket,
         COUNT(*)                   AS total,
         SUM(cache_hit)             AS cache_hits,
         SUM(rate_limited)          AS rate_limited,
         ROUND(AVG(duration_ms), 2) AS avg_latency_ms,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
       FROM request_logs
       WHERE user_id = ?`;

    const params = [formatMap[interval], req.user.id];

    // Only apply time window if not 'all'
    if (interval !== "all") {
      query += ` AND created_at >= NOW() - INTERVAL ? HOUR`;
      params.push(hours);
    }

    query += ` GROUP BY bucket ORDER BY bucket ASC`;

    const [rows] = await pool.query(query, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/by-route
router.get("/by-route", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);

  try {
    const [rows] = await pool.query(
      `SELECT
         route_prefix,
         COUNT(*)                                                            AS total_requests,
         SUM(cache_hit)                                                      AS cache_hits,
         ROUND(SUM(cache_hit) / COUNT(*) * 100, 2)                          AS cache_hit_rate_pct,
         SUM(rate_limited)                                                   AS rate_limited_count,
         ROUND(AVG(duration_ms), 2)                                         AS avg_latency_ms,
         MIN(duration_ms)                                                    AS min_latency_ms,
         MAX(duration_ms)                                                    AS max_latency_ms,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)                AS error_count,
         ROUND(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS error_rate_pct
       FROM request_logs
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL ? HOUR
       GROUP BY route_prefix
       ORDER BY total_requests DESC`,
      [req.user.id, hours],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/status-codes
router.get("/status-codes", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);

  try {
    const [rows] = await pool.query(
      `SELECT
         status_code,
         COUNT(*) AS count,
         ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 2) AS percentage
       FROM request_logs
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL ? HOUR
       GROUP BY status_code
       ORDER BY count DESC`,
      [req.user.id, hours],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/top-clients
router.get("/top-clients", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 720);
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const [rows] = await pool.query(
      `SELECT
         client_ip,
         COUNT(*)          AS total_requests,
         SUM(rate_limited) AS times_rate_limited,
         ROUND(AVG(duration_ms), 2) AS avg_latency_ms,
         MAX(created_at)   AS last_seen
       FROM request_logs
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL ? HOUR
         AND client_ip IS NOT NULL
       GROUP BY client_ip
       ORDER BY total_requests DESC
       LIMIT ?`,
      [req.user.id, hours, limit],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/recent-logs
router.get("/recent-logs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const routePrefix = req.query.route_prefix || null;

  try {
    const conditions = ["user_id = ?"];
    const params = [req.user.id];

    if (routePrefix) {
      conditions.push("route_prefix = ?");
      params.push(routePrefix);
    }

    params.push(limit, offset);

    const [rows] = await pool.query(
      `SELECT id, route_prefix, method, path, status_code, duration_ms,
              cache_hit, rate_limited, client_ip, created_at
       FROM request_logs
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params,
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
