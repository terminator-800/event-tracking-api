import { pool } from "../config/db";

export async function createFinesTable(): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS fines (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        student_id     INT NOT NULL,
        event_id       INT NOT NULL,        -- references YOUR existing events table
        attendance_id  INT NOT NULL,
        reason         ENUM(
          'Missed AM Time In',
          'Missed AM Time Out',
          'Missed PM Time In',
          'Missed PM Time Out'
        ) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status         ENUM('Unpaid', 'Paid', 'Waived') NOT NULL DEFAULT 'Unpaid',
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id)    REFERENCES students(id)    ON DELETE CASCADE,
        FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
        FOREIGN KEY (attendance_id) REFERENCES attendance(id)  ON DELETE CASCADE
      );
    `);
  }