/**
 * db/migrate.js
 *
 * Run once to provision the database schema.
 * Design: All DDL is in one place so the schema is readable as a document,
 * not scattered across the codebase. Each table has a clear, single purpose.
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

await connection.query(
  `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``
);
await connection.query(`USE \`${process.env.DB_NAME}\``);

/**
 * routes
 * Each row is one "managed API route" that users register through the dashboard.
 * The proxy reads this table on startup and watches for changes.
 *
 * - prefix:         The path prefix the proxy listens on. e.g. "/api/v1/users"
 * - upstream_url:   Where requests are forwarded to. e.g. "https://legacy-api.internal"
 * - cache_enabled:  Whether the LRU cache is active for this route.
 * - cache_ttl_ms:   Per-route TTL override. NULL means use the global default.
 * - rate_limit_enabled: Whether token-bucket rate limiting is active.
 * - rate_limit_capacity: Max tokens (burst size).
 * - rate_limit_refill_rate: Tokens added per second.
 */
await connection.query(`
  CREATE TABLE IF NOT EXISTS routes (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100) NOT NULL,
    prefix         VARCHAR(255) NOT NULL UNIQUE,
    upstream_url   VARCHAR(500) NOT NULL,
    cache_enabled  TINYINT(1) NOT NULL DEFAULT 1,
    cache_ttl_ms   INT UNSIGNED DEFAULT NULL,
    rate_limit_enabled    TINYINT(1) NOT NULL DEFAULT 1,
    rate_limit_capacity   INT UNSIGNED NOT NULL DEFAULT 100,
    rate_limit_refill_rate FLOAT NOT NULL DEFAULT 10,
    is_active      TINYINT(1) NOT NULL DEFAULT 1,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

/**
 * request_logs
 * The destination for the Buffer-and-Batch logger.
 *
 * This table is WRITE-HEAVY. Design choices to handle that:
 * - No foreign key on route_id (avoids a row lock on the routes table per insert).
 * - route_prefix is denormalized here so analytics queries can filter without a JOIN.
 * - Indexes on (route_prefix, created_at) and (status_code) cover the most common
 *   analytics queries: "requests per route over time" and "error rate by code".
 * - We do NOT index `request_body` or `response_body`; they are large and rarely queried.
 */
await connection.query(`
  CREATE TABLE IF NOT EXISTS request_logs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    route_id        INT UNSIGNED DEFAULT NULL,
    route_prefix    VARCHAR(255) NOT NULL,
    method          VARCHAR(10) NOT NULL,
    path            VARCHAR(1000) NOT NULL,
    status_code     SMALLINT UNSIGNED NOT NULL,
    duration_ms     INT UNSIGNED NOT NULL,
    cache_hit       TINYINT(1) NOT NULL DEFAULT 0,
    rate_limited    TINYINT(1) NOT NULL DEFAULT 0,
    client_ip       VARCHAR(45) DEFAULT NULL,
    request_size_bytes  INT UNSIGNED DEFAULT 0,
    response_size_bytes INT UNSIGNED DEFAULT 0,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_route_time  (route_prefix, created_at),
    INDEX idx_status_code (status_code),
    INDEX idx_created_at  (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

/**
 * api_keys
 * Used by the dashboard API to authenticate management requests.
 * The actual proxy routes do NOT require an api_key by default - they are
 * meant to be transparent to existing clients.
 */
await connection.query(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    key_hash    VARCHAR(64) NOT NULL UNIQUE,
    label       VARCHAR(100) NOT NULL,
    is_active   TINYINT(1) NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`);

console.log("Migration complete. All tables created.");
await connection.end();
