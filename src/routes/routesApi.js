/**
 * routes/routesApi.js
 *
 * CRUD endpoints for managing proxy routes through the dashboard.
 *
 * Design: Thin controller. Each handler does only:
 * 1. Validate input
 * 2. Execute one DB operation
 * 3. Return the result
 *
 * No business logic lives here. The route registry polling picks up changes
 * automatically within RELOAD_INTERVAL_MS seconds.
 */

import { Router } from "express";
import pool from "../db/pool.js";
import { loadRoutes } from "../proxy/routeRegistry.js";

const router = Router();

/**
 * GET /api/routes
 * Returns all registered routes (including inactive ones for the dashboard).
 */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM routes ORDER BY created_at DESC",
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/routes/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM routes WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/routes
 * Registers a new managed route.
 */
router.post("/", async (req, res) => {
  const {
    name,
    prefix,
    upstream_url,
    cache_enabled = true,
    cache_ttl_ms = null,
    rate_limit_enabled = true,
    rate_limit_capacity = 100,
    rate_limit_refill_rate = 10,
  } = req.body;

  if (!name || !prefix || !upstream_url) {
    return res.status(400).json({
      success: false,
      error: "name, prefix, and upstream_url are required",
    });
  }

  if (!prefix.startsWith("/")) {
    return res.status(400).json({
      success: false,
      error: "prefix must start with /",
    });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO routes
         (name, prefix, upstream_url, cache_enabled, cache_ttl_ms,
          rate_limit_enabled, rate_limit_capacity, rate_limit_refill_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        prefix,
        upstream_url,
        cache_enabled ? 1 : 0,
        cache_ttl_ms,
        rate_limit_enabled ? 1 : 0,
        rate_limit_capacity,
        rate_limit_refill_rate,
      ],
    );

    // Immediately reload the registry so the new route is live without waiting
    // for the next poll cycle.
    await loadRoutes();

    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        error: `A route with prefix "${prefix}" already exists`,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/routes/:id
 * Partial update. Only the fields provided in the body are changed.
 */
router.patch("/:id", async (req, res) => {
  const allowed = [
    "name",
    "upstream_url",
    "cache_enabled",
    "cache_ttl_ms",
    "rate_limit_enabled",
    "rate_limit_capacity",
    "rate_limit_refill_rate",
    "is_active",
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "No valid fields to update" });
  }

  try {
    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = [...Object.values(updates), req.params.id];

    const [result] = await pool.query(
      `UPDATE routes SET ${setClauses} WHERE id = ?`,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }

    await loadRoutes();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/routes/:id
 * Hard delete. In a production system you might prefer setting is_active = 0.
 */
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM routes WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }
    await loadRoutes();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
