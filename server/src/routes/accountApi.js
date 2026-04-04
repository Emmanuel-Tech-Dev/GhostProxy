import { Router } from "express";
import bcrypt from "bcrypt";
import pool from "../db/pool.js";
import { signAccessToken } from "../auth/tokenService.js";

const router = Router();

const BCRYPT_ROUNDS = 12;

router.patch("/", async (req, res) => {
  const { full_name } = req.body;

  const [result] = await pool.query(
    "UPDATE users SET full_name = ? WHERE id = ?",
    [full_name, req.user.id],
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const [rows] = await pool.query(
    "SELECT id, email, plan_tier FROM users WHERE id = ?",
    [req.user.id],
  );

  const accessToken = signAccessToken(rows[0]);

  return res.json({
    success: true,
    data: { access_token: accessToken, user: rows[0] },
  });
});

router.patch("/password", async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: "current_password and new_password are required",
    });
  }

  if (new_password.length < 8) {
    return res.status(400).json({
      success: false,
      error: "new_password must be at least 8 characters",
    });
  }

  const [rows] = await pool.query(
    "SELECT password_hash FROM users WHERE id = ?",
    [req.user.id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const match = await bcrypt.compare(current_password, rows[0].password_hash);

  if (!match) {
    return res.status(401).json({
      success: false,
      error: "Current password is incorrect",
    });
  }

  const password_hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
    password_hash,
    req.user.id,
  ]);

  return res.json({ success: true });
});

export default router;
