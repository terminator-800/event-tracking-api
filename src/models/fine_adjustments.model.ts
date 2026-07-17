import { pool } from "../config/db";

/**
 * Existing database (run manually in MySQL Workbench):
 *
 * ALTER TABLE fine_adjustments
 *   ADD COLUMN academic_period_id INT NULL AFTER fine_id,
 *   ADD INDEX idx_fine_adjustments_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_fine_adjustments_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 */
export async function createFineAdjustmentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fine_adjustments (
      id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
      fine_id             INT NOT NULL,
      academic_period_id  INT NULL,
      old_amount          DECIMAL(12,2) NOT NULL,
      new_amount          DECIMAL(12,2) NOT NULL,
      adjustment_reason   VARCHAR(255) NOT NULL,
      adjusted_by_user_id INT NOT NULL,
      adjusted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_fine_adjustments_fine_adjusted_at (fine_id, adjusted_at),
      INDEX idx_fine_adjustments_user_adjusted_at (adjusted_by_user_id, adjusted_at),
      INDEX idx_fine_adjustments_adjusted_at (adjusted_at),
      INDEX idx_fine_adjustments_academic_period (academic_period_id),

      FOREIGN KEY (fine_id) REFERENCES fines(id) ON DELETE CASCADE,
      FOREIGN KEY (adjusted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);
}
