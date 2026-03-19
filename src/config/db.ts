import mysql from "mysql2/promise";
import { env } from "./env";

export const pool = mysql.createPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export async function testDatabaseConnection(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
