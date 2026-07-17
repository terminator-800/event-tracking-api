import { pool } from "../config/db";

/**
 * Existing database (run manually in MySQL Workbench):
 *
 * ALTER TABLE payments
 *   ADD COLUMN academic_period_id INT NULL AFTER student_id,
 *   ADD INDEX idx_payments_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_payments_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 *
 * Legacy: add transaction_id manually if missing (see payment_transactions.model.ts).
 */
export async function createPaymentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id              BIGINT AUTO_INCREMENT PRIMARY KEY,
      student_id      INT NOT NULL,
      academic_period_id INT NULL,
      fine_id         INT NULL,
      amount_paid     DECIMAL(12,2) NOT NULL,
      receipt_no      VARCHAR(50) NOT NULL UNIQUE,
      payment_method  ENUM('Cash', 'GCash', 'Bank Transfer', 'Other') NOT NULL DEFAULT 'Cash',
      remarks         VARCHAR(255) NULL,
      paid_by_user_id INT NOT NULL,
      transaction_id  BIGINT NULL,
      paid_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      INDEX idx_payments_student_paid_at (student_id, paid_at),
      INDEX idx_payments_fine_paid_at (fine_id, paid_at),
      INDEX idx_payments_paid_by_paid_at (paid_by_user_id, paid_at),
      INDEX idx_payments_paid_at (paid_at),
      INDEX idx_payments_transaction_id (transaction_id),
      INDEX idx_payments_academic_period (academic_period_id),

      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (fine_id) REFERENCES fines(id) ON DELETE SET NULL,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);
}
