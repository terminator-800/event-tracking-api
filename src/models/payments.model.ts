import { pool } from "../config/db";

/**
 * Existing database: add transaction_id manually in Workbench (see payment_transactions.model.ts).
 */
export async function createPaymentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id              BIGINT AUTO_INCREMENT PRIMARY KEY,
      student_id      INT NOT NULL,
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

      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (fine_id) REFERENCES fines(id) ON DELETE SET NULL,
      FOREIGN KEY (paid_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL
    );
  `);
}
