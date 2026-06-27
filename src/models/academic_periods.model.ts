import { pool } from "../config/db";

/** Canonical semester values (match CSV import + enrollments). */
export const ACADEMIC_PERIOD_SEMESTERS = ["1st sem", "2nd sem", "summer"] as const;
export type AcademicPeriodSemester = (typeof ACADEMIC_PERIOD_SEMESTERS)[number];

export const ACADEMIC_PERIOD_STATUSES = ["draft", "active", "archived"] as const;
export type AcademicPeriodStatus = (typeof ACADEMIC_PERIOD_STATUSES)[number];

/**
 * School year + semester periods configured by super_admin.
 * Exactly one row should be `active` at a time (enforced in application logic).
 *
 * Existing database (run manually in MySQL Workbench if the table is missing):
 *
 * CREATE TABLE academic_periods (
 *   id INT AUTO_INCREMENT PRIMARY KEY,
 *   school_year VARCHAR(20) NOT NULL,
 *   semester ENUM('1st sem', '2nd sem', 'summer') NOT NULL,
 *   status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
 *   label VARCHAR(100) NULL,
 *   starts_on DATE NULL,
 *   ends_on DATE NULL,
 *   activated_at TIMESTAMP NULL,
 *   activated_by_user_id INT NULL,
 *   created_by_user_id INT NULL,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   UNIQUE KEY uq_academic_period_sy_sem (school_year, semester),
 *   FOREIGN KEY (activated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
 *   FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
 * );
 */
export async function createAcademicPeriodsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS academic_periods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      school_year VARCHAR(20) NOT NULL,
      semester ENUM('1st sem', '2nd sem', 'summer') NOT NULL,
      status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
      label VARCHAR(100) NULL,
      starts_on DATE NULL,
      ends_on DATE NULL,
      activated_at TIMESTAMP NULL,
      activated_by_user_id INT NULL,
      created_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_academic_period_sy_sem (school_year, semester),
      FOREIGN KEY (activated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}
