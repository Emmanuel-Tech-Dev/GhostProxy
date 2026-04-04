/**
 * routes/routesApi.js
 *
 * CRUD for proxy routes. Every query is scoped to req.user.id.
 * A user can only see, create, update, and delete their own routes.
 *
 * This is the application-layer enforcement of multi-tenancy.
 * The DB has a user_id column and FK, but we never rely on the DB constraint
 * alone - we always filter by req.user.id in every query explicitly.
 */

import { Router } from "express";
import pool from "../db/pool.js";
import { loadRoutes } from "../proxy/routeRegistry.js";

const router = Router();

// GET /api/routes
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM routes WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/routes/:id
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM routes WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Route not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/routes
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
         (user_id, name, prefix, upstream_url, cache_enabled, cache_ttl_ms,
          rate_limit_enabled, rate_limit_capacity, rate_limit_refill_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
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

    await loadRoutes();
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        error: `You already have a route with prefix "${prefix}"`,
      });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/routes/:id
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
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
    const values = [...Object.values(updates), req.params.id, req.user.id];

    const [result] = await pool.query(
      `UPDATE routes SET ${setClauses} WHERE id = ? AND user_id = ?`,
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

// DELETE /api/routes/:id
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM routes WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
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

export default router;
