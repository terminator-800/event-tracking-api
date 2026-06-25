import { pool } from "../config/db";

/**
 * CSV import → students table (all optional):
 *   Student Number  → student_id
 *   RFID            → rfid
 *   Full Name       → full_name
 *   Year Level      → year_level
 *
 * Existing database (run manually in MySQL Workbench if columns are missing):
 *
 * ALTER TABLE students ADD COLUMN rfid VARCHAR(32) NULL UNIQUE;
 * ALTER TABLE students ADD COLUMN full_name VARCHAR(255) NULL;
 * ALTER TABLE students ADD COLUMN year_level TINYINT NULL;
 * ALTER TABLE students ADD COLUMN email VARCHAR(100) NULL UNIQUE;
 * ALTER TABLE students MODIFY COLUMN student_id VARCHAR(20) NULL;
 * ALTER TABLE students MODIFY COLUMN first_name VARCHAR(100) NULL;
 * ALTER TABLE students MODIFY COLUMN last_name VARCHAR(100) NULL;
 */

/** Student Number → student_id */
export const STUDENTS_CSV_STUDENT_NUMBER_HEADERS = [
  "student number",
  "id number",
  "student id",
  "studentnumber",
  "student no",
  "student no.",
] as const;

/** RFID → rfid */
export const STUDENTS_CSV_RFID_HEADERS = ["rfid", "rfid number", "rfid tag"] as const;

/** Full Name → full_name */
export const STUDENTS_CSV_FULL_NAME_HEADERS = [
  "full name",
  "fullname",
  "complete name",
  "name",
] as const;

/** Year Level → year_level */
export const STUDENTS_CSV_YEAR_LEVEL_HEADERS = [
  "year level",
  "level",
  "year",
  "yearlevel",
  "yr level",
  "yr",
] as const;

export const STUDENTS_CSV_FIRST_NAME_HEADERS = ["first name", "firstname", "fname"] as const;
export const STUDENTS_CSV_MIDDLE_NAME_HEADERS = ["middle name", "middlename", "mname"] as const;
export const STUDENTS_CSV_LAST_NAME_HEADERS = ["last name", "lastname", "lname", "surname"] as const;

export async function createStudentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id VARCHAR(20) NULL UNIQUE,
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
}
