/**
 * server.js
 *
 * Application entry point.
 *
 * Startup sequence order matters:
 * 1. Load env vars before any module reads process.env.
 * 2. Load routes from DB so the interceptor is ready before we accept traffic.
 * 3. Register middleware in the correct order.
 * 4. Start the logger flush timer.
 * 5. Bind to the port and begin accepting connections.
 *
 * Shutdown sequence:
 * SIGTERM -> stop accepting new connections -> flush logs -> close DB pool -> exit.
 * This order ensures no request is dropped mid-flight and no logs are lost.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadRoutes, startWatching } from "./routeRegistry.js";
import { interceptor } from "./interceptor.js";
import { startFlushing, stopFlushing } from "./batchLogger.js";
import routesApi from "./routesApi.js";
import analyticsApi from "./analyticsApi.js";
import errorHandler from "./ErrorHandler.js";
import pool from "./pool.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// --- Middleware ---

app.use(
  cors({
    // In production, restrict this to your dashboard origin.
    origin: process.env.CORS_ORIGIN || "*",
  })
);

// Parse JSON bodies for the management API.
// The interceptor bypasses this because it reads the raw request stream itself.
app.use(express.json());

// --- Health check ---
// Always responds immediately. Used by load balancers and Docker healthchecks.
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- Management API ---
// These are registered BEFORE the interceptor so that requests to /api/*
// are handled by the management router and do not get proxied upstream.
app.use("/api/routes", routesApi);
app.use("/api/analytics", analyticsApi);

// --- Proxy Interceptor ---
// Catches all requests that are not management API endpoints.
// matchRoute() inside the interceptor determines whether to proxy or fall through.
app.use(interceptor);

// --- 404 fallback ---
// Reached only if the interceptor calls next() and no other handler matched.
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No managed route matches "${req.path}". Register it via POST /api/routes.`,
  });
});

// --- Central error handler ---
app.use(errorHandler);

// --- Startup ---
async function start() {
  // Load routes first. If this fails, we should not start accepting traffic.
  await loadRoutes();
  startWatching();
  startFlushing();

  const server = app.listen(PORT, () => {
    console.log(`[Server] Observability Wrapper running on port ${PORT}`);
    console.log(`[Server] Management API: http://localhost:${PORT}/api`);
    console.log(`[Server] Health check:   http://localhost:${PORT}/health`);
  });

  // --- Graceful Shutdown ---
  async function shutdown(signal) {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections. Existing connections finish normally.
    server.close(async () => {
      console.log("[Server] HTTP server closed.");

      await stopFlushing();

      await pool.end();
      console.log("[Server] DB pool closed. Goodbye.");
      process.exit(0);
    });

    // Force exit if shutdown takes longer than 15 seconds.
    setTimeout(() => {
      console.error("[Server] Forced shutdown after timeout.");
      process.exit(1);
    }, 15000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});
