import mysql from "mysql2/promise";
import { env } from "./env";

// Step 1: Ensure the database exists before the pool connects to it.
// On shared hosting (cPanel), the DB user usually cannot CREATE DATABASE —
// the schema must already exist. Treat permission errors as non-fatal.
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
  } catch (error) {
    const err = error as { code?: string; errno?: number; message?: string };
    const noCreatePrivilege =
      err.code === "ER_DBACCESS_DENIED_ERROR" ||
      err.code === "ER_SPECIFIC_ACCESS_DENIED_ERROR" ||
      err.errno === 1044 ||
      err.errno === 1227;

    if (noCreatePrivilege) {
      console.warn(
        `Skipping CREATE DATABASE for "${env.dbName}" (no privilege). ` +
          "Ensure the database already exists in cPanel and is assigned to this user.",
      );
      return;
    }

    throw error;
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
  timezone: "+08:00",
  dateStrings: true,
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
