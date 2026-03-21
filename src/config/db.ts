import mysql from "mysql2/promise";
import { env } from "./env";

// Step 1: Ensure the database exists before the pool connects to it
async function createDatabase(): Promise<void> {
  const conn = await mysql.createConnection({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUser,
    password: env.dbPassword,
    // ❌ no database specified
  });

  try {
    await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${env.dbName}\``);
    console.log(`Database "${env.dbName}" created/verified`);
  } finally {
    await conn.end();
  }
}

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
  await createDatabase();
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
