import { pool } from "../config/db";
import { GOVERNOR_ROLE, LEGACY_GOVERNOR_ROLES } from "../utils/roles";

/**
 * Existing database (run manually in MySQL Workbench if auto-migrate fails):
 *
 * ALTER TABLE users
 *   MODIFY COLUMN role ENUM(
 *     'super_admin',
 *     'admin',
 *     'csg_president',
 *     'governor',
 *     'it_governor',
 *     'cba_governor',
 *     'ceas_governor',
 *     'coc_governor',
 *     'chm_governor'
 *   ) NOT NULL DEFAULT 'csg_president';
 *
 * UPDATE users SET role = 'governor'
 * WHERE role IN ('it_governor','cba_governor','ceas_governor','coc_governor','chm_governor');
 *
 * ALTER TABLE users
 *   MODIFY COLUMN role ENUM(
 *     'super_admin',
 *     'admin',
 *     'csg_president',
 *     'governor',
 *     'cashier'
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
        'governor',
        'cashier',
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

  await migrateUsersRoleEnumToUnifiedGovernor();
}

/** Expand ENUM, merge legacy governor roles into `governor`, then shrink ENUM. */
async function migrateUsersRoleEnumToUnifiedGovernor(): Promise<void> {
  try {
    await pool.execute(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM(
          'super_admin',
          'admin',
          'csg_president',
          'governor',
          'cashier',
          'it_governor',
          'cba_governor',
          'ceas_governor',
          'coc_governor',
          'chm_governor'
        ) NOT NULL DEFAULT 'csg_president'
    `);
  } catch (error) {
    console.warn("[users] Could not expand role ENUM (may already include governor/cashier):", error);
  }

  const legacyList = LEGACY_GOVERNOR_ROLES.map((r) => `'${r}'`).join(",");
  try {
    await pool.execute(
      `UPDATE users SET role = '${GOVERNOR_ROLE}' WHERE role IN (${legacyList})`,
    );
  } catch (error) {
    console.warn("[users] Could not migrate legacy governor roles:", error);
  }

  try {
    await pool.execute(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM(
          'super_admin',
          'admin',
          'csg_president',
          'governor',
          'cashier'
        ) NOT NULL DEFAULT 'csg_president'
    `);
  } catch (error) {
    console.warn("[users] Could not shrink role ENUM after governor unify:", error);
  }
}
