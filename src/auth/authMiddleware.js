/**
 * auth/authMiddleware.js
 *
 * Express middleware that verifies the JWT on every protected route
 * and attaches the decoded user to req.user.
 *
 * Design: This middleware does ONE thing - verify identity.
 * Authorization (what the user is allowed to do) is handled separately
 * in each route handler by filtering queries to req.user.id.
 *
 * HOW IT WORKS:
 * The client sends the access token in the Authorization header:
 *   Authorization: Bearer <access_token>
 *
 * The middleware:
 * 1. Extracts the token from the header
 * 2. Verifies the signature and expiry using the JWT secret
 * 3. Attaches the decoded payload to req.user
 * 4. Calls next() if valid, returns 401 if not
 *
 * WHY BEARER TOKEN AND NOT COOKIE:
 * Cookies work well for browser-based apps but are awkward for API clients
 * (Insomnia, curl, mobile apps). Bearer tokens in the Authorization header
 * are the universal standard for API authentication.
 * When we build the React dashboard we can store the token in memory
 * (not localStorage - XSS risk) and send it as a header.
 */

import { verifyAccessToken } from "./tokenService.js";

/**
 * Protects any route that requires authentication.
 * Attach to individual routes or entire routers.
 *
 * Usage:
 *   router.get('/routes', requireAuth, (req, res) => { ... })
 *   app.use('/api', requireAuth, apiRouter)
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error:
        "Authorization header missing or malformed. Expected: Bearer <token>",
    });
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  try {
    const payload = verifyAccessToken(token);

    // Attach decoded user to the request for use in route handlers.
    // Every protected route can now access req.user.id, req.user.email,
    // and req.user.plan_tier without another DB query.
    req.user = {
      id: payload.sub,
      email: payload.email,
      plan_tier: payload.plan_tier,
    };

    next();
  } catch (err) {
    // jwt.verify throws specific error types we can surface to the client.
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        error: "Access token expired. Use /auth/refresh to get a new one.",
        code: "TOKEN_EXPIRED",
      });
    }

    return res.status(401).json({
      success: false,
      error: "Invalid access token.",
      code: "TOKEN_INVALID",
    });
  }
}

/**
 * Optional auth middleware. Attaches req.user if a valid token is present
 * but does not reject the request if no token is found.
 *
 * Used for routes that behave differently for authenticated vs anonymous users
 * but do not require authentication to access at all.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      plan_tier: payload.plan_tier,
    };
  } catch {
    // Invalid token - treat as unauthenticated, do not reject.
  }

  next();
}

export { requireAuth, optionalAuth };
