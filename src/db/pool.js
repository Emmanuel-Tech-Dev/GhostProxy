/**
 * db/pool.js
 *
 * Singleton connection pool.
 *
 * Design: A pool is used instead of a single connection for two reasons:
 * 1. MySQL connections are stateful and can drop. A pool auto-reconnects.
 * 2. The batch logger and the analytics routes both need DB access concurrently.
 *    A pool lets them each grab a connection without blocking each other.
 *
 * We export the pool instance directly. Any module that needs the DB imports
 * this file. Node's module cache ensures only one pool is ever created.
 */

import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  // password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // How many connections to keep open at once.
  // Most analytics queries are short-lived, so 10 is generous for a single-node setup.
  connectionLimit: 10,

  // Automatically ping idle connections so MySQL does not close them
  // after the default 8-hour wait_timeout.
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,

  // Return dates as strings, not JS Date objects, to avoid timezone surprises.
  dateStrings: true,
});

export default pool;
