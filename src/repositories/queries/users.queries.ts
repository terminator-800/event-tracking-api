export const UserQueries = {
  insertAdmin: `INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')`,
  findByUsername: `SELECT * FROM users WHERE username = ?`,
};