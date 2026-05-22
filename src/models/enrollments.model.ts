import { pool } from "../config/db";

export async function createEnrollmentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enrollment_ref VARCHAR(50) NULL UNIQUE,
      student_id INT NOT NULL,
      program_id INT NULL,
      school_year VARCHAR(20) NULL,
      semester VARCHAR(20) NULL,
      year_level INT NULL,
      enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, program_id, school_year, semester),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (program_id) REFERENCES programs(id)
    );
  `);
}