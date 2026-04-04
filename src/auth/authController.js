/**
 * auth/authController.js
 *
 * Handles user registration, login, token refresh, and logout.
 *
 * Design: Thin controller pattern.
 * Each handler validates input, calls the appropriate service function,
 * and returns a consistent response shape. No business logic lives here.
 *
 * PASSWORD HASHING STRATEGY:
 * bcrypt is used with a cost factor of 12. This means hashing takes ~250ms
 * on modern hardware - slow enough to make brute-force attacks impractical,
 * fast enough that legitimate users do not notice.
 * Never use MD5, SHA1, or SHA256 for passwords - they are too fast.
 *
 * RESPONSE SHAPE:
 * Access token is returned in the response body.
 * Refresh token is set as an httpOnly cookie.
 *
 * WHY httpOnly COOKIE FOR REFRESH TOKEN:
 * An httpOnly cookie cannot be read by JavaScript. This means XSS attacks
 * cannot steal the refresh token even if they execute arbitrary JS on the page.
 * The access token lives in memory (JS-accessible) but expires in 15 minutes,
 * limiting the damage window.
 */

import bcrypt from "bcrypt";
import pool from "../db/pool.js";
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
} from "./tokenService.js";

const BCRYPT_ROUNDS = 12;

// Cookie settings for the refresh token.
// secure: true in production forces HTTPS-only.
// sameSite: strict prevents CSRF attacks.
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: "/auth/refresh", // Cookie only sent to the refresh endpoint
};

/**
 * POST /auth/register
 *
 * Creates a new user account.
 * Returns access token immediately so the user does not need to login
 * separately after registering.
 */
async function register(req, res) {
  const { email, password, full_name } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "email and password are required",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      error: "password must be at least 8 characters",
    });
  }

  // Basic email format check. Full validation happens via unique constraint.
  if (!email.includes("@")) {
    return res.status(400).json({
      success: false,
      error: "invalid email address",
    });
  }

  try {
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const [result] = await pool.query(
      "INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)",
      [email.toLowerCase().trim(), password_hash, full_name || null],
    );

    const user = {
      id: result.insertId,
      email: email.toLowerCase().trim(),
      plan_tier: "self_hosted",
    };

    const accessToken = signAccessToken(user);
    const refreshToken = await createRefreshToken(user.id);

    res.cookie("refresh_token", refreshToken, REFRESH_COOKIE_OPTIONS);

    return res.status(201).json({
      success: true,
      data: {
        access_token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: full_name || null,
          plan_tier: user.plan_tier,
        },
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists",
      });
    }
    throw err;
  }
}

/**
 * POST /auth/login
 *
 * Authenticates a user and returns tokens.
 *
 * WHY WE USE THE SAME ERROR MESSAGE FOR WRONG EMAIL AND WRONG PASSWORD:
 * Returning "email not found" vs "wrong password" lets an attacker enumerate
 * which emails are registered. Always return the same message for both cases.
 */
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "email and password are required",
    });
  }

  const [rows] = await pool.query(
    "SELECT * FROM users WHERE email = ? AND is_active = 1",
    [email.toLowerCase().trim()],
  );

  // Use a constant-time comparison even when the user does not exist.
  // Without this, an attacker can tell if an email is registered by measuring
  // the response time - a missing user returns instantly, a wrong password
  // takes ~250ms for bcrypt. We hash a dummy value to normalize timing.
  const user = rows[0];
  const hashToCompare = user
    ? user.password_hash
    : "$2b$12$invalidhashusedfortimingattackprevention00000000000000";

  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatch) {
    return res.status(401).json({
      success: false,
      error: "Invalid email or password",
    });
  }

  const userPayload = {
    id: user.id,
    email: user.email,
    plan_tier: user.plan_tier,
  };

  const accessToken = signAccessToken(userPayload);
  const refreshToken = await createRefreshToken(user.id);

  res.cookie("refresh_token", refreshToken, REFRESH_COOKIE_OPTIONS);

  return res.json({
    success: true,
    data: {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        plan_tier: user.plan_tier,
      },
    },
  });
}

/**
 * POST /auth/refresh
 *
 * Issues a new access token using the refresh token from the httpOnly cookie.
 * Rotates the refresh token on every use.
 */
async function refresh(req, res) {
  const rawToken = req.cookies?.refresh_token;

  if (!rawToken) {
    return res.status(401).json({
      success: false,
      error: "Refresh token missing",
      code: "NO_REFRESH_TOKEN",
    });
  }

  try {
    const { accessToken, refreshToken, user } =
      await rotateRefreshToken(rawToken);

    res.cookie("refresh_token", refreshToken, REFRESH_COOKIE_OPTIONS);

    return res.json({
      success: true,
      data: {
        access_token: accessToken,
        user: {
          id: user.id,
          email: user.email,
          plan_tier: user.plan_tier,
        },
      },
    });
  } catch (err) {
    // Clear the invalid cookie so the client does not keep retrying.
    res.clearCookie("refresh_token", { path: "/auth/refresh" });
    return res.status(401).json({
      success: false,
      error: err.message,
      code: "REFRESH_FAILED",
    });
  }
}

/**
 * POST /auth/logout
 *
 * Revokes all refresh tokens for the user and clears the cookie.
 * The access token will expire naturally after 15 minutes.
 *
 * WHY NOT INVALIDATE THE ACCESS TOKEN:
 * Access tokens are stateless - there is no central registry to check them
 * against. The only way to "invalidate" them is to wait for expiry.
 * This is why the expiry is kept short (15 min). For immediate invalidation
 * (e.g. account compromise), rotate the JWT_ACCESS_SECRET in .env and
 * restart the server - all outstanding tokens become invalid instantly.
 */
async function logout(req, res) {
  await revokeAllRefreshTokens(req.user.id);
  res.clearCookie("refresh_token", { path: "/auth/refresh" });
  return res.json({ success: true });
}

/**
 * GET /auth/me
 *
 * Returns the currently authenticated user's profile.
 * Useful for the dashboard to verify the token and display user info on load.
 */
async function me(req, res) {
  const [rows] = await pool.query(
    "SELECT id, email, full_name, plan_tier, created_at FROM users WHERE id = ?",
    [req.user.id],
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  return res.json({ success: true, data: rows[0] });
}

export { register, login, refresh, logout, me };
