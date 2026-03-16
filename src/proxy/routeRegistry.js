/**
 * proxy/routeRegistry.js
 *
 * Loads route configurations from MySQL and makes them available to the proxy.
 *
 * Design: Registry Pattern.
 * The proxy does not hit the database on every request (that would make DB
 * latency part of every proxied response). Instead, we load all active routes
 * once at startup and cache them in memory as a Map.
 *
 * To pick up new routes without a restart, we poll the DB every
 * RELOAD_INTERVAL_MS. This is a simple "poor man's config reload" that works
 * well up to hundreds of routes. For thousands of routes, you would switch to
 * a database LISTEN/NOTIFY (PostgreSQL) or a Redis pub/sub invalidation signal.
 *
 * HOW ROUTE MATCHING WORKS:
 * We store routes keyed by prefix. The proxy does a longest-prefix match.
 * e.g., if "/api/v1/users" and "/api/v1" are both registered, a request to
 * "/api/v1/users/42" matches "/api/v1/users" because it is more specific.
 */

import pool from "../db/pool.js";

const RELOAD_INTERVAL_MS = 15000; // Re-read routes from DB every 15 seconds.

// The in-memory registry. Maps prefix -> route config object.
let registry = new Map();

/**
 * Reads all active routes from the DB and rebuilds the in-memory registry.
 * Swaps atomically: the old registry is used until the new one is fully built.
 */
async function loadRoutes() {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM routes WHERE is_active = 1 ORDER BY LENGTH(prefix) DESC",
    );

    const next = new Map();
    for (const row of rows) {
      next.set(row.prefix, row);
    }

    // Atomic swap. Any in-flight request using the old registry will complete
    // normally. The next request picks up the new one.
    registry = next;
    console.log(`[RouteRegistry] Loaded ${registry.size} active routes.`);
  } catch (err) {
    // If the reload fails (e.g., DB blip), keep the existing registry.
    // Stale config is better than no config.
    console.error(
      "[RouteRegistry] Reload failed, keeping existing config:",
      err.message,
    );
  }
}

/**
 * Finds the most specific (longest) matching route for a given request path.
 *
 * @param {string} requestPath - e.g. "/api/v1/users/42"
 * @returns {object|null} The matching route config or null.
 */
function matchRoute(requestPath) {
  // The registry is sorted by prefix length DESC (done in the SQL ORDER BY).
  // We iterate and return the first (longest) match.

  console.log(requestPath);
  for (const [prefix, config] of registry) {
    if (requestPath.startsWith(prefix)) {
      console.log("[RouteRegistry] Matched:", requestPath, "->", prefix); // temporary

      return config;
    }
  }
  return null;
}

/**
 * Returns all routes currently in the registry (for the dashboard API).
 * @returns {object[]}
 */
function getAllRoutes() {
  return Array.from(registry.values());
}

/**
 * Starts the periodic reload timer.
 * Must be called once at server startup, after the initial loadRoutes().
 */
function startWatching() {
  const timer = setInterval(loadRoutes, RELOAD_INTERVAL_MS);
  timer.unref();
}

export { loadRoutes, matchRoute, getAllRoutes, startWatching };
