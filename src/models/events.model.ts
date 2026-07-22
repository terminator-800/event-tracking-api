import { pool } from "../config/db";
import { randomUUID } from "crypto";

/**
 * Existing database (run manually in MySQL Workbench if auto-migrate fails):
 *
 * ALTER TABLE events
 *   ADD COLUMN academic_period_id INT NULL AFTER created_by,
 *   ADD INDEX idx_events_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_events_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 *
 * ALTER TABLE events
 *   ADD COLUMN event_mode ENUM('TIME_IN_OUT','TIME_IN_ONLY') NOT NULL DEFAULT 'TIME_IN_OUT'
 *   AFTER duration;
 *
 * ALTER TABLE events
 *   ADD COLUMN event_uuid CHAR(36) NULL AFTER id,
 *   ADD COLUMN event_version INT NOT NULL DEFAULT 1 AFTER event_uuid,
 *   ADD COLUMN master_event_uuid CHAR(36) NULL AFTER event_version,
 *   ADD UNIQUE KEY uq_events_event_uuid (event_uuid),
 *   ADD INDEX idx_events_master_uuid (master_event_uuid);
 */
export async function createEventsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      event_uuid          CHAR(36) NULL,
      event_version       INT NOT NULL DEFAULT 1,
      master_event_uuid   CHAR(36) NULL,
      name                VARCHAR(255) NOT NULL,
      date                DATE         NOT NULL,
      venue               VARCHAR(255) NOT NULL,
      duration            ENUM('Whole Day','Half Day','AM Only','PM Only') NOT NULL DEFAULT 'Whole Day',
      event_mode          ENUM('TIME_IN_OUT','TIME_IN_ONLY') NOT NULL DEFAULT 'TIME_IN_OUT',
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
      attendance_password_hash VARCHAR(255) NULL,
      attendance_password_encrypted VARCHAR(1024) NULL,
      created_by          INT NOT NULL,
      academic_period_id  INT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_events_event_uuid (event_uuid),
      INDEX idx_events_master_uuid (master_event_uuid),
      INDEX idx_events_academic_period (academic_period_id),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);

  await ensureColumn(
    `ALTER TABLE events
      ADD COLUMN event_mode ENUM('TIME_IN_OUT','TIME_IN_ONLY') NOT NULL DEFAULT 'TIME_IN_OUT'
      AFTER duration`,
  );
  await ensureColumn(`ALTER TABLE events ADD COLUMN event_uuid CHAR(36) NULL AFTER id`);
  await ensureColumn(
    `ALTER TABLE events ADD COLUMN event_version INT NOT NULL DEFAULT 1 AFTER event_uuid`,
  );
  await ensureColumn(
    `ALTER TABLE events ADD COLUMN master_event_uuid CHAR(36) NULL AFTER event_version`,
  );

  try {
    await pool.execute(`ALTER TABLE events ADD UNIQUE KEY uq_events_event_uuid (event_uuid)`);
  } catch (err: unknown) {
    const code = (err as { code?: string; errno?: number })?.code;
    if (code !== "ER_DUP_KEYNAME" && code !== "ER_DUP_ENTRY") {
      // ignore duplicate index
    }
  }
  try {
    await pool.execute(`ALTER TABLE events ADD INDEX idx_events_master_uuid (master_event_uuid)`);
  } catch {
    /* index may exist */
  }

  await ensureColumn(
    `ALTER TABLE events
      ADD COLUMN attendance_password_encrypted VARCHAR(1024) NULL
      AFTER attendance_password_hash`,
  );

  // Backfill UUIDs for legacy rows.
  const [missing] = await pool.execute(
    `SELECT id FROM events WHERE event_uuid IS NULL OR TRIM(event_uuid) = ''`,
  );
  for (const row of missing as Array<{ id: number }>) {
    const uuid = randomUUID();
    await pool.execute(
      `UPDATE events
       SET event_uuid = ?,
           master_event_uuid = COALESCE(NULLIF(TRIM(master_event_uuid), ''), ?)
       WHERE id = ?`,
      [uuid, uuid, row.id],
    );
  }
}

async function ensureColumn(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "ER_DUP_FIELDNAME") throw err;
  }
}

/** Generate a new event UUID (and default master = self for master events). */
export function newEventUuid(): string {
  return randomUUID();
}
