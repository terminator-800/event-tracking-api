export const UserQueries = {
  insertAdmin: `INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')`,
  findByUsername: `SELECT * FROM users WHERE username = ?`,
  hasAdminUser: `SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`,
};