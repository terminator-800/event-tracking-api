import { pool } from "../config/db";

/**
 * New installs: created automatically via createTables().
 *
 * Existing database (run manually in MySQL Workbench):
 *
 * ALTER TABLE payment_transactions
 *   ADD COLUMN academic_period_id INT NULL AFTER student_id,
 *   ADD INDEX idx_payment_txn_academic_period (academic_period_id),
 *   ADD CONSTRAINT fk_payment_txn_academic_period
 *     FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT;
 *
 * Legacy setup (if still needed):
 *
 * ALTER TABLE payments
 *   ADD COLUMN transaction_id BIGINT NULL AFTER paid_by_user_id,
 *   ADD INDEX idx_payments_transaction_id (transaction_id),
 *   ADD CONSTRAINT fk_payments_transaction
 *     FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL;
 *
 * ALTER TABLE payment_transactions
 *   ADD COLUMN status ENUM('Paid', 'Partial') NOT NULL DEFAULT 'Partial' AFTER paid_by_user_id;
 *
 * ALTER TABLE payment_transactions
 *   ADD COLUMN previous_balance DECIMAL(12,2) NULL AFTER status,
 *   ADD COLUMN balance_after DECIMAL(12,2) NULL AFTER previous_balance;
 */
export async function createPaymentTransactionsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
      transaction_code    VARCHAR(50) NOT NULL UNIQUE,
      student_id          INT NOT NULL,
      academic_period_id  INT NULL,
      total_amount_paid   DECIMAL(12,2) NOT NULL,
      payment_method      ENUM('Cash', 'GCash', 'Bank Transfer', 'Other') NOT NULL DEFAULT 'Cash',
      remarks             VARCHAR(255) NULL,
      paid_by_user_id     INT NOT NULL,
      status              ENUM('Paid', 'Partial') NOT NULL DEFAULT 'Partial',
      previous_balance    DECIMAL(12,2) NULL,
      balance_after       DECIMAL(12,2) NULL,
      paid_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      INDEX idx_payment_txn_student_paid_at (student_id, paid_at),
      INDEX idx_payment_txn_paid_at (paid_at),
      INDEX idx_payment_txn_academic_period (academic_period_id),

      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id) ON DELETE RESTRICT
    );
  `);
}
