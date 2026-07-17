import { pool } from "../config/db";

/**
 * CSV import → enrollments table (semester roster snapshot):
 *   School Year  → school_year
 *   Semester     → semester
 *   Year Level   → year_level
 *
 * Each academic period has its own enrollment snapshot. Importing for 2nd Sem
 * must not delete or overwrite enrollments from 1st Sem.
 *
 * Existing database (run manually in MySQL Workbench if columns are missing):
 *
 * ALTER TABLE enrollments ADD COLUMN enrollment_ref VARCHAR(50) NULL UNIQUE;
 * ALTER TABLE enrollments ADD COLUMN program_id INT NULL;
 * ALTER TABLE enrollments ADD COLUMN school_year VARCHAR(20) NULL;
 * ALTER TABLE enrollments ADD COLUMN semester VARCHAR(20) NULL;
 * ALTER TABLE enrollments ADD COLUMN year_level INT NULL;
 *
 * ALTER TABLE enrollments
 *   ADD COLUMN academic_period_id INT NULL AFTER program_id,
 *   ADD INDEX idx_enrollments_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_enrollments_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 *
 * Optional after data cleanup (one roster row per student per period):
 *
 * ALTER TABLE enrollments
 *   ADD UNIQUE KEY uq_enrollment_student_period (student_id, academic_period_id);
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
      academic_period_id INT NULL,
      school_year VARCHAR(20) NULL,
      semester VARCHAR(20) NULL,
      year_level INT NULL,
      enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, program_id, school_year, semester),
      INDEX idx_enrollments_academic_period (academic_period_id),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (program_id) REFERENCES programs(id),
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);
}
