/**
 * auth/tokenService.js
 *
 * Handles all JWT operations: signing, verifying, and refreshing tokens.
 *
 * WHY TWO TOKENS (access + refresh):
 * A single long-lived token is a security liability. If it leaks, the attacker
 * has access until expiry - which could be days or weeks.
 *
 * The two-token pattern solves this:
 * - Access token:  short-lived (15 min). Used on every API request.
 *                  Stateless - verified with the JWT secret, no DB lookup needed.
 *                  If leaked, useless after 15 minutes.
 *
 * - Refresh token: long-lived (7 days). Used only to get a new access token.
 *                  Stored as a hash in the DB. Invalidated on logout.
 *                  If leaked, we can revoke it immediately via the DB.
 *
 * WHY NOT USE A LIBRARY LIKE passport.js:
 * Passport adds abstraction over a problem that is not complex enough to need it.
 * We only have one auth strategy (JWT). Direct jsonwebtoken usage is clearer,
 * more debuggable, and has fewer hidden dependencies.
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../db/pool.js";

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || "15m";
const REFRESH_TOKEN_TTL_MS =
  Number(process.env.JWT_REFRESH_TTL_MS) || 7 * 24 * 60 * 60 * 1000;

/**
 * Signs a short-lived access token for the given user.
 * The payload is intentionally minimal - only what the middleware needs.
 * Do not include sensitive data in JWT payloads. They are base64 encoded,
 * not encrypted - anyone can decode them.
 *
 * @param {{ id: number, email: string, plan_tier: string }} user
 * @returns {string}
 */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      plan_tier: user.plan_tier,
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

/**
 * Creates a cryptographically random refresh token, stores its hash in
 * the DB, and returns the raw token to send to the client.
 *
 * WHY CRYPTO RANDOM AND NOT JWT FOR REFRESH:
 * Refresh tokens do not need to be self-describing. They are opaque strings
 * that map to a DB row. Using crypto.randomBytes produces a token that
 * carries no decodable information, which is safer.
 *
 * @param {number} userId
 * @returns {Promise<string>} The raw refresh token (send to client, never store raw).
 */
async function createRefreshToken(userId) {
  const raw = crypto.randomBytes(40).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await pool.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, hash, expiresAt],
  );

  return raw;
}

/**
 * Verifies an access token and returns the decoded payload.
 * Throws if the token is invalid or expired.
 *
 * @param {string} token
 * @returns {{ sub: number, email: string, plan_tier: string }}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
}

/**
 * Validates a refresh token against the DB, rotates it (deletes old, creates new),
 * and returns a fresh access token + new refresh token.
 *
 * WHY ROTATE REFRESH TOKENS:
 * Token rotation means each refresh token can only be used once. After use,
 * a new one is issued and the old one is deleted. If an attacker steals a
 * refresh token and tries to use it after the legitimate user has already
 * rotated it, the token will not be found in the DB and the request fails.
 *
 * @param {string} rawToken
 * @returns {Promise<{ accessToken: string, refreshToken: string, user: object }>}
 */
async function rotateRefreshToken(rawToken) {
  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const [rows] = await pool.query(
    `SELECT rt.*, u.id as user_id, u.email, u.plan_tier, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ? AND rt.expires_at > NOW()`,
    [hash],
  );

  if (rows.length === 0) {
    throw new Error("Invalid or expired refresh token");
  }

  const row = rows[0];

  if (!row.is_active) {
    throw new Error("User account is deactivated");
  }

  // Delete the used refresh token immediately (rotation).
  await pool.query("DELETE FROM refresh_tokens WHERE token_hash = ?", [hash]);

  const user = { id: row.user_id, email: row.email, plan_tier: row.plan_tier };
  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);

  return { accessToken, refreshToken, user };
}

/**
 * Invalidates all refresh tokens for a user.
 * Called on logout and password change.
 *
 * @param {number} userId
 */
async function revokeAllRefreshTokens(userId) {
  await pool.query("DELETE FROM refresh_tokens WHERE user_id = ?", [userId]);
}

/**
 * Deletes expired refresh tokens from the DB.
 * Should be called on a schedule (e.g. daily) to keep the table clean.
 * In a cloud deployment this would be a cron job or a scheduled Lambda.
 */
async function pruneExpiredTokens() {
  const [result] = await pool.query(
    "DELETE FROM refresh_tokens WHERE expires_at < NOW()",
  );
  return result.affectedRows;
}

export {
  signAccessToken,
  createRefreshToken,
  verifyAccessToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
  pruneExpiredTokens,
};
