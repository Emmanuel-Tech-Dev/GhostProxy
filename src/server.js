/**
 * server.js
 *
 * Application entry point.
 *
 * Startup sequence:
 * 1. Load env vars
 * 2. Load routes from DB
 * 3. Register middleware in correct order
 * 4. Start logger flush timer
 * 5. Bind to port
 *
 * Middleware order matters:
 * - cookieParser must run before any route that reads cookies (auth/refresh)
 * - express.json must run before routes that read req.body
 * - Auth routes are public - mounted before requireAuth middleware
 * - All /api/* routes are protected - requireAuth runs before them
 * - Proxy interceptor runs last - catches everything not handled above
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { loadRoutes, startWatching } from "./proxy/routeRegistry.js";
import { interceptor } from "./proxy/interceptor.js";
import { startFlushing, stopFlushing } from "./logger/batchLogger.js";
import authApi from "./routes/authApi.js";
import routesApi from "./routes/routesApi.js";
import analyticsApi from "./routes/analyticsApi.js";
import errorHandler from "./middleware/errorHandler.js";
import { requireAuth } from "./auth/authMiddleware.js";
import pool from "./db/pool.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// ─── Core middleware ──────────────────────────────────────────────────────────

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true, // Required for cookies to be sent cross-origin
  }),
);

// cookieParser must run before any route that reads req.cookies.
// The refresh token lives in an httpOnly cookie.
app.use(cookieParser());

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/auth", authApi);

app.use("/api/routes", requireAuth, routesApi);
app.use("/api/analytics", requireAuth, analyticsApi);

// ─── Proxy interceptor ────────────────────────────────────────────────────────

app.use(interceptor);

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No managed route matches "${req.path}".`,
  });
});

// ─── Central error handler ────────────────────────────────────────────────────

app.use(errorHandler);

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  await loadRoutes();
  startWatching();
  startFlushing();

  const server = app.listen(PORT, () => {
    console.log(`[Server] GhostProxy running on port ${PORT}`);
    console.log(`[Server] Auth API:        http://localhost:${PORT}/auth`);
    console.log(`[Server] Management API:  http://localhost:${PORT}/api`);
    console.log(`[Server] Health check:    http://localhost:${PORT}/health`);
  });

  async function shutdown(signal) {
    console.log(`\n[Server] ${signal} received. Shutting down...`);
    server.close(async () => {
      await stopFlushing();
      await pool.end();
      console.log("[Server] Clean shutdown complete.");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
