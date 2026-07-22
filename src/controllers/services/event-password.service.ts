import bcrypt from "bcrypt";
import {
  decryptValue,
  encryptValue,
} from "./export-security.service";

export const MIN_EVENT_PASSWORD_LENGTH = 6;

export async function hashEventPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, 10);
}

/** Hash + reversible encrypt so Super Admin can reveal the attendance password. */
export async function prepareEventPasswordStorage(plainPassword: string): Promise<{
  hash: string;
  encrypted: string;
}> {
  const plain = String(plainPassword ?? "").trim();
  return {
    hash: await hashEventPassword(plain),
    encrypted: encryptValue(plain),
  };
}

export function revealStoredPassword(encrypted: string | null | undefined): string | null {
  if (!encrypted || !String(encrypted).trim()) return null;
  try {
    return decryptValue(String(encrypted).trim());
  } catch {
    return null;
  }
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
