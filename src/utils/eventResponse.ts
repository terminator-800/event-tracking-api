export function sanitizeEventRow<T extends Record<string, unknown>>(row: T) {
  if (!row || typeof row !== "object") return row;
  const {
    attendance_password_hash,
    attendance_password_encrypted,
    ...rest
  } = row as T & {
    attendance_password_hash?: string | null;
    attendance_password_encrypted?: string | null;
  };
  const requiresPassword = Boolean(attendance_password_hash);
  return {
    ...rest,
    requiresPassword,
    requires_password: requiresPassword,
    has_attendance_password: requiresPassword,
    hasAttendancePassword: requiresPassword,
  };
}

export function sanitizeEventRows(rows: Record<string, unknown>[]) {
  return Array.isArray(rows) ? rows.map((row) => sanitizeEventRow(row)) : [];
}
