export const UserQueries = {
  insertAdmin: `INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')`,
  insertSuperAdmin: `INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'super_admin')`,
  findByUsername: `SELECT * FROM users WHERE username = ?`,
  hasAdminUser: `SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`,
  hasSuperAdminUser: `SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1`,
};