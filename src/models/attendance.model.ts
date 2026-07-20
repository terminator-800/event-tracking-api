import { pool } from "../config/db";

/**
 * Existing database (run manually in MySQL Workbench):
 *
 * ALTER TABLE attendance
 *   ADD COLUMN academic_period_id INT NULL AFTER event_id,
 *   ADD INDEX idx_attendance_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_attendance_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 */
export async function createAttendanceTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS attendance (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      student_id          INT NOT NULL,
      event_id            INT NOT NULL,
      academic_period_id  INT NULL,
      am_time_in          TIME NULL,
      am_time_out         TIME NULL,
      pm_time_in          TIME NULL,
      pm_time_out         TIME NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE (student_id, event_id),
      INDEX idx_attendance_academic_period (academic_period_id),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id)   REFERENCES events(id)   ON DELETE CASCADE,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);

  await ensureColumn(
    `ALTER TABLE attendance ADD COLUMN academic_period_id INT NULL AFTER event_id`,
  );
  await ensureIndex(
    `ALTER TABLE attendance ADD INDEX idx_attendance_academic_period (academic_period_id)`,
  );
  await ensureFk(
    `ALTER TABLE attendance
      ADD CONSTRAINT fk_attendance_academic_period
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT`,
  );

  await pool.execute(`
    UPDATE attendance a
    INNER JOIN events e ON e.id = a.event_id
    SET a.academic_period_id = e.academic_period_id
    WHERE a.academic_period_id IS NULL
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
    if (code === "ER_DUP_KEYNAME" || errno === 1826 || errno === 1005) return;
    throw err;
  }
}
