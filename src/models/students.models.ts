import { pool } from "../config/db";

async function ensureColumn(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Duplicate column")) return;
    throw error;
  }
}

async function ensureStudentsSchema(): Promise<void> {
  await ensureColumn("ALTER TABLE students ADD COLUMN rfid VARCHAR(32) NULL");
  await ensureColumn("ALTER TABLE students ADD COLUMN full_name VARCHAR(255) NULL");
  await ensureColumn("ALTER TABLE students ADD COLUMN year_level TINYINT NULL");
  await ensureColumn("ALTER TABLE students ADD COLUMN email VARCHAR(100) NULL");
  try {
    await pool.execute("ALTER TABLE students MODIFY COLUMN first_name VARCHAR(100) NULL");
    await pool.execute("ALTER TABLE students MODIFY COLUMN last_name VARCHAR(100) NULL");
  } catch {
    // ignore if table shape differs
  }
}

export async function createStudentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id VARCHAR(20) NOT NULL UNIQUE,
      rfid VARCHAR(32) NULL UNIQUE,
      full_name VARCHAR(255) NULL,
      year_level TINYINT NULL,
      first_name VARCHAR(100) NULL,
      middle_name VARCHAR(100) NULL,
      last_name VARCHAR(100) NULL,
      email VARCHAR(100) NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureStudentsSchema();
}