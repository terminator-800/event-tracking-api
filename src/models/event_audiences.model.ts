import { pool } from "../config/db";

export async function createEventAudiencesTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS event_audiences (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      event_id      INT NOT NULL,
      department_id INT,               
      program_id    INT,              
      year_level    INT NULL,         
      FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      FOREIGN KEY (program_id)    REFERENCES programs(id)    ON DELETE CASCADE
    );
  `);
}