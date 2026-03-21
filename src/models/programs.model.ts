import { pool } from "../config/db";

export async function createProgramsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS programs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_code VARCHAR(20) NOT NULL,
      course_name VARCHAR(100) NOT NULL,
      major VARCHAR(100),
      department_id INT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    )
  `);
}