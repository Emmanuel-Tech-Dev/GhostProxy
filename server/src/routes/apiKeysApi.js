import { Router } from "express";
import crypto from "crypto";
import pool from "../db/pool.js";

const router = Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, key_prefix, label, type, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    [req.user.id],
  );
  res.json({ success: true, data: rows });
});

router.post("/", async (req, res) => {
  const { label = "New Key", type = "management" } = req.body;

  if (!["management", "proxy"].includes(type)) {
    return res.status(400).json({ success: false, error: "Invalid key type" });
  }

  const raw = crypto.randomBytes(32).toString("hex");
  const key_hash = crypto.createHash("sha256").update(raw).digest("hex");
  const key_prefix = raw.slice(0, 8);

  await pool.query(
    "INSERT INTO api_keys (user_id, key_hash, key_prefix, label, type) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, key_hash, key_prefix, label, type],
  );

  return res.status(201).json({
    success: true,
    data: { raw_key: raw, key_prefix },
  });
});

router.delete("/:id", async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM api_keys WHERE id = ? AND user_id = ?",
    [req.params.id, req.user.id],
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, error: "Key not found" });
  }

  res.json({ success: true });
});

export default router;
