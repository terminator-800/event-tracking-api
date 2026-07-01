import { pool } from "../config/db";

export async function createExportAuditLogTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS export_audit_log (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      action         ENUM('export','import','import_rejected') NOT NULL,
      event_id       INT NULL,
      event_name     VARCHAR(255) NULL,
      user_id        INT NULL,
      username       VARCHAR(255) NULL,
      file_name      VARCHAR(255) NULL,
      protected      TINYINT(1) NOT NULL DEFAULT 0,
      import_status  VARCHAR(64) NULL COMMENT 'success | invalid_password | invalid_file | no_event',
      notes          TEXT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}
