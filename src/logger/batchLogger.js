/**
 * logger/batchLogger.js
 *
 * Implements the Buffer-and-Batch (Producer/Consumer) pattern for request logging.
 *
 * THE PROBLEM WITH NAIVE LOGGING:
 * Writing one MySQL INSERT per HTTP request is synchronous with the request
 * lifecycle. Under load (1000 req/s), you serialize 1000 DB round-trips per second.
 * MySQL can handle this, but each write adds ~1-5ms of latency to EVERY response.
 *
 * THE SOLUTION: Decouple the hot path from the DB write.
 * 1. Producer: The proxy middleware calls log() after each request completes.
 *    This is non-blocking and takes ~0ms (just appending to an array).
 * 2. Consumer: A background interval wakes every LOG_FLUSH_INTERVAL_MS (10s)
 *    and sends one bulk INSERT for all buffered rows. MySQL bulk inserts are
 *    dramatically faster than sequential single-row inserts.
 * 3. Safety valve: If the buffer reaches LOG_BUFFER_MAX_SIZE (1000 entries)
 *    before the timer fires, a flush is triggered immediately.
 *
 * TRADE-OFF:
 * If the process crashes, logs in the buffer since the last flush are lost.
 * For a monitoring tool this is acceptable. To reduce the window, lower
 * LOG_FLUSH_INTERVAL_MS. For zero-loss, use Redis Streams as a durable buffer.
 *
 * GRACEFUL SHUTDOWN:
 * On SIGTERM, we flush synchronously before exit so a clean deployment does
 * not drop the final batch of logs.
 */

import pool from "../db/pool.js";

const BUFFER_MAX_SIZE = Number(process.env.LOG_BUFFER_MAX_SIZE) || 1000;
const FLUSH_INTERVAL_MS = Number(process.env.LOG_FLUSH_INTERVAL_MS) || 10000;

// The in-memory buffer. Each entry is a plain object matching the
// request_logs table columns. We use a plain Array because push() and
// splice(0) are O(1) amortized.
let buffer = [];

// Whether a flush is currently in progress.
// Prevents two concurrent flushes from sending overlapping data.
let isFlushing = false;

// Reference to the setInterval timer so we can clear it on shutdown.
let flushTimer = null;

/**
 * Appends a log entry to the in-memory buffer.
 * This is the only function the proxy middleware calls. It must never throw.
 *
 * @param {object} entry
 * @param {number|null} entry.route_id
 * @param {string} entry.route_prefix
 * @param {string} entry.method
 * @param {string} entry.path
 * @param {number} entry.status_code
 * @param {number} entry.duration_ms
 * @param {boolean} entry.cache_hit
 * @param {boolean} entry.rate_limited
 * @param {string} entry.client_ip
 * @param {number} entry.request_size_bytes
 * @param {number} entry.response_size_bytes
 */
function log(entry) {
  buffer.push(entry);

  // Safety valve: flush early if the buffer is full.
  if (buffer.length >= BUFFER_MAX_SIZE) {
    flush(); // intentionally not awaited - fire and forget
  }
}

/**
 * Drains the buffer and writes all accumulated entries to MySQL in one
 * bulk INSERT statement.
 *
 * We "swap" the buffer out before the async DB call. This means new log()
 * calls during the flush go into a fresh buffer and are not at risk of being
 * included in an in-flight INSERT or lost if it fails.
 */
async function flush() {
  if (isFlushing || buffer.length === 0) return;

  isFlushing = true;

  // Atomic swap: take the current buffer and replace it with an empty one.
  // Any log() calls happening after this line write into the new empty buffer.
  const batch = buffer;
  buffer = [];

  try {
    // Build one multi-row INSERT. The mysql2 library accepts an array of arrays
    // for the values clause and handles escaping.
    const rows = batch.map((e) => [
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
         (route_id, route_prefix, method, path, status_code, duration_ms,
          cache_hit, rate_limited, client_ip, request_size_bytes, response_size_bytes)
       VALUES ?`,
      [rows],
    );

    console.log(`[BatchLogger] Flushed ${rows.length} log entries to DB.`);
  } catch (err) {
    // On failure, put the batch back at the front of the buffer so it is
    // retried on the next flush cycle. This avoids data loss for transient
    // DB hiccups (e.g., a connection blip).
    console.error("[BatchLogger] Flush failed, re-queuing batch:", err.message);
    buffer = [...batch, ...buffer];
  } finally {
    isFlushing = false;
  }
}

/**
 * Starts the background flush timer.
 * Called once at server startup.
 */
function startFlushing() {
  if (flushTimer) return; // Already running.
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  // setInterval holds the event loop open. unref() lets the process exit
  // naturally without waiting for the timer if everything else is done.
  flushTimer.unref();

  console.log(
    `[BatchLogger] Started. Flushing every ${FLUSH_INTERVAL_MS}ms or every ${BUFFER_MAX_SIZE} entries.`,
  );
}

/**
 * Stops the timer and performs a final synchronous flush.
 * Called during graceful shutdown (SIGTERM, SIGINT).
 */
async function stopFlushing() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  console.log("[BatchLogger] Shutting down, flushing remaining buffer...");
  await flush();
}

export { log, flush, startFlushing, stopFlushing };
