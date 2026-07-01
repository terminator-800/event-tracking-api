import { pool } from "../config/db";

export async function createSystemExportSettingsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS system_export_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      password_encrypted VARCHAR(1024) NULL COMMENT 'AES-256-CBC encrypted password for PDF protection',
      password_hash VARCHAR(255) NULL COMMENT 'bcrypt hash for password verification',
      export_fingerprint VARCHAR(64) NULL COMMENT 'SHA-256 of password_hash used to sign CSV exports',
      is_enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_by_user_id INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}
