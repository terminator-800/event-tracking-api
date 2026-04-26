import { pool } from "../config/db";

export async function createFinesTable(): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS fines (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        student_id     INT NOT NULL,
        event_id       INT NOT NULL,       
        attendance_id  INT NULL,
        reason ENUM(
          'Late AM',
          'Absent AM',
          'Absent AM Time Out',  
          'Missed AM Time Out',
          'Late PM',
          'Absent PM',
          'Absent PM Time Out',   
          'Missed PM Time Out'
        ) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        paid_amount     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        status         ENUM('Unpaid', 'Partial', 'Paid', 'Waived') NOT NULL DEFAULT 'Unpaid',
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_fine (student_id, event_id, reason),
        FOREIGN KEY (student_id)    REFERENCES students(id)    ON DELETE CASCADE,
        FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
        FOREIGN KEY (attendance_id) REFERENCES attendance(id)  ON DELETE CASCADE
      );
    `);
  }