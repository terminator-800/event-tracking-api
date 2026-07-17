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
}
