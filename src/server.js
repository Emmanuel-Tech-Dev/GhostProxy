import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadRoutes, startWatching } from "./proxy/routeRegistry.js";
import { interceptor } from "./proxy/interceptor.js";
import { startFlushing, stopFlushing } from "./logger/batchLogger.js";
import routesApi from "./routes/routesApi.js";
import analyticsApi from "./routes/analyticsApi.js";
import errorHandler from "./ErrorHandler.js";
import pool from "./db/pool.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// --- Middleware ---

app.use(
  cors({
    // In production, restrict this to your dashboard origin.
    origin: process.env.CORS_ORIGIN || "*",
  }),
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- Management API ---

app.use("/api/routes", routesApi);
app.use("/api/analytics", analyticsApi);

// --- Proxy Interceptor ---

app.use(interceptor);

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
