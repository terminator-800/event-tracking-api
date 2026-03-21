import { pool } from '../config/db';

export async function createDepartmentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      code VARCHAR(20) NOT NULL UNIQUE
    )
  `);
}