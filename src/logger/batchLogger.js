import pool from "../db/pool.js";

const BUFFER_MAX_SIZE = Number(process.env.LOG_BUFFER_MAX_SIZE) || 1000;
const FLUSH_INTERVAL_MS = Number(process.env.LOG_FLUSH_INTERVAL_MS) || 10000;

let buffer = [];
let isFlushing = false;
let flushTimer = null;

function log(entry) {
  buffer.push(entry);
  if (buffer.length >= BUFFER_MAX_SIZE) flush();
}

async function flush() {
  if (isFlushing || buffer.length === 0) return;
  isFlushing = true;

  const batch = buffer;
  buffer = [];

  try {
    const rows = batch.map((e) => [
      e.user_id ?? null,
      e.route_id ?? null,
      e.route_prefix,
      e.method,
      e.path,
      e.status_code,
      e.duration_ms,
      e.cache_hit ? 1 : 0,
      e.rate_limited ? 1 : 0,
      e.client_ip ?? null,
      e.request_size_bytes ?? 0,
      e.response_size_bytes ?? 0,
    ]);

    await pool.query(
      `INSERT INTO request_logs
         (user_id, route_id, route_prefix, method, path, status_code,
          duration_ms, cache_hit, rate_limited, client_ip,
          request_size_bytes, response_size_bytes)
       VALUES ?`,
      [rows],
    );

    console.log(`[BatchLogger] Flushed ${rows.length} entries.`);
  } catch (err) {
    console.error("[BatchLogger] Flush failed, re-queuing:", err.message);
    buffer = [...batch, ...buffer];
  } finally {
    isFlushing = false;
  }
}

function startFlushing() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  flushTimer.unref();
  console.log(
    `[BatchLogger] Started. Interval: ${FLUSH_INTERVAL_MS}ms, max buffer: ${BUFFER_MAX_SIZE}.`,
  );
}

async function stopFlushing() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
}

export { log, flush, startFlushing, stopFlushing };
