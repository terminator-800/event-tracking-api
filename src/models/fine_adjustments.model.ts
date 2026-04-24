import { pool } from "../config/db";

export async function createFineAdjustmentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS fine_adjustments (
      id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
      fine_id             INT NOT NULL,
      old_amount          DECIMAL(12,2) NOT NULL,
      new_amount          DECIMAL(12,2) NOT NULL,
      adjustment_reason   VARCHAR(255) NOT NULL,
      adjusted_by_user_id INT NOT NULL,
      adjusted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_fine_adjustments_fine_adjusted_at (fine_id, adjusted_at),
      INDEX idx_fine_adjustments_user_adjusted_at (adjusted_by_user_id, adjusted_at),
      INDEX idx_fine_adjustments_adjusted_at (adjusted_at),

      FOREIGN KEY (fine_id) REFERENCES fines(id) ON DELETE CASCADE,
      FOREIGN KEY (adjusted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
  `);
}
