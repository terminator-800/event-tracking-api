import { pool } from "../config/db";

export async function createEventsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      name                VARCHAR(255) NOT NULL,
      date                DATE         NOT NULL,
      venue               VARCHAR(255) NOT NULL,
      duration            ENUM('Whole Day','Half Day','AM Only','PM Only') NOT NULL DEFAULT 'Whole Day',
      am_time_in          TIME,
      am_grace_in         INT NOT NULL DEFAULT 0,
      am_time_out         TIME,
      am_grace_out        INT NOT NULL DEFAULT 0,
      pm_time_in          TIME,
      pm_grace_in         INT NOT NULL DEFAULT 0,
      pm_time_out         TIME,
      pm_grace_out        INT NOT NULL DEFAULT 0,
      is_mandatory        BOOLEAN      NOT NULL DEFAULT FALSE,
      is_all_departments  BOOLEAN      NOT NULL DEFAULT FALSE,
      fines_generated     BOOLEAN      NOT NULL DEFAULT FALSE,
      status              ENUM('Upcoming','Ongoing','Completed','Cancelled') NOT NULL DEFAULT 'Upcoming',
      audience_notes      TEXT,
      fine_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_by          INT NOT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    );
  `);
}