import { pool } from "../config/db";

/**
 * CSV import → enrollments table (all optional):
 *   School Year  → school_year
 *   Semester     → semester
 *   Year Level   → year_level
 *
 * Existing database (run manually in MySQL Workbench if columns are missing):
 *
 * ALTER TABLE enrollments ADD COLUMN enrollment_ref VARCHAR(50) NULL UNIQUE;
 * ALTER TABLE enrollments ADD COLUMN program_id INT NULL;
 * ALTER TABLE enrollments ADD COLUMN school_year VARCHAR(20) NULL;
 * ALTER TABLE enrollments ADD COLUMN semester VARCHAR(20) NULL;
 * ALTER TABLE enrollments ADD COLUMN year_level INT NULL;
 */

/** School Year → school_year */
export const ENROLLMENTS_CSV_SCHOOL_YEAR_HEADERS = [
  "school year",
  "schoolyear",
  "school yr",
  "sy",
  "academic year",
] as const;

/** Semester → semester */
export const ENROLLMENTS_CSV_SEMESTER_HEADERS = [
  "semester",
  "sem",
  "school semester",
] as const;

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
