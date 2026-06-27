import { pool } from "../config/db";

/**
 * Existing database (run manually in MySQL Workbench):
 *
 * ALTER TABLE users
 *   ADD COLUMN full_name VARCHAR(255) NULL AFTER username;
 *
 * ALTER TABLE users
 *   MODIFY COLUMN role ENUM(
 *     'super_admin',
 *     'admin',
 *     'csg_president',
 *     'it_governor',
 *     'cba_governor',
 *     'ceas_governor',
 *     'coc_governor',
 *     'chm_governor'
 *   ) NOT NULL DEFAULT 'csg_president';
 */
export async function createUsersTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      full_name VARCHAR(255) NULL,
      password VARCHAR(255) NOT NULL,
        role ENUM(
        'super_admin',
        'admin',
        'csg_president',
        'it_governor',
        'cba_governor',
        'ceas_governor',
        'coc_governor',
        'chm_governor'
      ) NOT NULL DEFAULT 'csg_president',

      student_id INT,                
      department_id INT,             
      program_id INT,                

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT,
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT
    )
  `);
}