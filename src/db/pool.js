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
