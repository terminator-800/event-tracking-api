import { pool } from '../config/db';

export async function createAttendanceTable(): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS attendance (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        student_id    INT NOT NULL,
        event_id      INT NOT NULL,        
        am_time_in    TIME NULL,
        am_time_out   TIME NULL,
        pm_time_in    TIME NULL,
        pm_time_out   TIME NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE (student_id, event_id),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id)   REFERENCES events(id)   ON DELETE CASCADE
      );
    `);
  }
