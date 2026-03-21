import { pool } from "../config/db";

export class UserRepository {
  async insertAdmin(
    username: string,
    hashedPassword: string,
  ): Promise<void> {
    await pool.execute(
      `INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')`,
      [username, hashedPassword]
    );
  }
}