import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  // password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  connectionLimit: 10,

  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,

  dateStrings: true,
});

export default pool;
