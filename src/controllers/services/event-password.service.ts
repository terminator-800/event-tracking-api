import bcrypt from "bcrypt";

export const MIN_EVENT_PASSWORD_LENGTH = 6;

export async function hashEventPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, 10);
}

export async function verifyEventPassword(
  plainPassword: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!passwordHash || !plainPassword) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

export function parseAttendancePasswordFromBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  return String(record.attendancePassword ?? record.attendance_password ?? "").trim();
}
