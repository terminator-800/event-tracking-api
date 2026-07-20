import { pool } from "../config/db";

/**
 * Existing database (run manually in MySQL Workbench if auto-migrate fails):
 *
 * ALTER TABLE fines
 *   ADD COLUMN academic_period_id INT NULL AFTER attendance_id,
 *   ADD INDEX idx_fines_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_fines_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 */
export async function createFinesTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fines (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      student_id     INT NOT NULL,
      event_id       INT NOT NULL,
      attendance_id  INT NULL,
      academic_period_id INT NULL,
      reason ENUM(
        'Late AM',
        'Absent AM',
        'Absent AM Time Out',
        'Missed AM Time Out',
        'Late PM',
        'Absent PM',
        'Absent PM Time Out',
        'Missed PM Time Out'
      ) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      paid_amount     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status         ENUM('Unpaid', 'Partial', 'Paid', 'Waived') NOT NULL DEFAULT 'Unpaid',
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_fine (student_id, event_id, reason),
      INDEX idx_fines_academic_period (academic_period_id),
      FOREIGN KEY (student_id)    REFERENCES students(id)    ON DELETE CASCADE,
      FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
      FOREIGN KEY (attendance_id) REFERENCES attendance(id)  ON DELETE CASCADE,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);

  // Legacy DBs: CREATE TABLE IF NOT EXISTS will not add columns added later.
  await ensureColumn(
    `ALTER TABLE fines ADD COLUMN academic_period_id INT NULL AFTER attendance_id`,
  );
  await ensureIndex(`ALTER TABLE fines ADD INDEX idx_fines_academic_period (academic_period_id)`);
  await ensureFk(
    `ALTER TABLE fines
      ADD CONSTRAINT fk_fines_academic_period
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT`,
  );

  await pool.execute(`
    UPDATE fines f
    INNER JOIN events e ON e.id = f.event_id
    SET f.academic_period_id = e.academic_period_id
    WHERE f.academic_period_id IS NULL
      AND e.academic_period_id IS NOT NULL
  `);
}

async function ensureColumn(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "ER_DUP_FIELDNAME") throw err;
  }
}

async function ensureIndex(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "ER_DUP_KEYNAME") throw err;
  }
}

async function ensureFk(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const errno = (err as { errno?: number })?.errno;
    // Duplicate constraint name / FK already exists
    if (code === "ER_DUP_KEYNAME" || errno === 1826 || errno === 1005) return;
    throw err;
  }
}
