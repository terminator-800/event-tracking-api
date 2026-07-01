import crypto from "crypto";
import bcrypt from "bcrypt";
import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import { env } from "../../config/env";

// ── Encryption helpers ─────────────────────────────────────────────────────────

/** Derive a deterministic 32-byte key from the JWT secret so no extra env var is needed. */
function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(env.jwtSecret || "nmci-fallback-key").digest();
}

export function encryptValue(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptValue(encrypted: string): string {
  const [ivHex, encHex] = encrypted.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid encrypted value format.");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getEncryptionKey(), iv);
  let decrypted = decipher.update(encHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Fingerprint = SHA-256(bcrypt_hash).
 * Embedded in exported CSVs so the receiver can verify origin without exposing the password.
 */
function computeFingerprint(passwordHash: string): string {
  return crypto.createHash("sha256").update(passwordHash).digest("hex");
}

// ── Row type ──────────────────────────────────────────────────────────────────

interface ExportSettingsRow extends RowDataPacket {
  id: number;
  password_encrypted: string | null;
  password_hash: string | null;
  export_fingerprint: string | null;
  is_enabled: number;
  created_by_user_id: number | null;
  created_by_username: string | null;
  updated_at: string | null;
}

// ── Public service functions ──────────────────────────────────────────────────

export interface ExportSettings {
  is_enabled: boolean;
  has_password: boolean;
  export_fingerprint: string | null;
  created_by_username: string | null;
  updated_at: string | null;
}

export async function getExportSettings(): Promise<ExportSettings> {
  const [rows] = await pool.execute<ExportSettingsRow[]>(`
    SELECT
      s.id, s.is_enabled, s.export_fingerprint, s.updated_at,
      u.username AS created_by_username,
      CASE WHEN s.password_encrypted IS NOT NULL THEN 1 ELSE 0 END AS has_password
    FROM system_export_settings s
    LEFT JOIN users u ON u.id = s.created_by_user_id
    LIMIT 1
  `);

  if (rows.length === 0) {
    return { is_enabled: false, has_password: false, export_fingerprint: null, created_by_username: null, updated_at: null };
  }

  const row = rows[0];
  return {
    is_enabled: Boolean(row.is_enabled),
    has_password: Boolean((row as unknown as { has_password: number }).has_password),
    export_fingerprint: row.export_fingerprint ?? null,
    created_by_username: row.created_by_username ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function setExportPassword(plainPassword: string, userId: number): Promise<void> {
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const passwordEncrypted = encryptValue(plainPassword);
  const fingerprint = computeFingerprint(passwordHash);

  const [existing] = await pool.execute<RowDataPacket[]>(`SELECT id FROM system_export_settings LIMIT 1`);

  if (existing.length === 0) {
    await pool.execute(
      `INSERT INTO system_export_settings
         (password_encrypted, password_hash, export_fingerprint, is_enabled, created_by_user_id)
       VALUES (?, ?, ?, 1, ?)`,
      [passwordEncrypted, passwordHash, fingerprint, userId],
    );
  } else {
    await pool.execute(
      `UPDATE system_export_settings
       SET password_encrypted = ?, password_hash = ?, export_fingerprint = ?,
           is_enabled = 1, created_by_user_id = ?, updated_at = NOW()`,
      [passwordEncrypted, passwordHash, fingerprint, userId],
    );
  }
}

export async function toggleExportProtection(enabled: boolean): Promise<{ success: false; message: string } | { success: true }> {
  const [existing] = await pool.execute<RowDataPacket[]>(`SELECT id, password_encrypted FROM system_export_settings LIMIT 1`);

  if (existing.length === 0 || !existing[0].password_encrypted) {
    return { success: false, message: "No export password has been set. Please create one first." };
  }

  await pool.execute(`UPDATE system_export_settings SET is_enabled = ?, updated_at = NOW()`, [enabled ? 1 : 0]);
  return { success: true };
}

/**
 * Returns the decrypted plain-text password for use in client-side PDF encryption.
 * Only returns a value when protection is enabled and a password exists.
 */
export async function getExportKeyForClient(): Promise<string | null> {
  const [rows] = await pool.execute<ExportSettingsRow[]>(
    `SELECT password_encrypted, is_enabled FROM system_export_settings LIMIT 1`,
  );
  if (rows.length === 0 || !rows[0].is_enabled || !rows[0].password_encrypted) return null;
  try {
    return decryptValue(rows[0].password_encrypted);
  } catch {
    return null;
  }
}

/**
 * Verifies whether a fingerprint from an exported CSV matches the current system export password.
 * Returns a descriptive result object.
 */
export async function verifyExportFingerprint(fingerprint: string): Promise<{
  valid: boolean;
  message: string;
}> {
  if (!fingerprint?.trim()) {
    return { valid: false, message: "No export fingerprint found in the file. This file was not generated by this system." };
  }

  const [rows] = await pool.execute<ExportSettingsRow[]>(
    `SELECT export_fingerprint, is_enabled FROM system_export_settings LIMIT 1`,
  );

  if (rows.length === 0 || !rows[0].export_fingerprint) {
    return { valid: false, message: "No System Export Password is configured. Cannot verify this file." };
  }

  const matches = rows[0].export_fingerprint === fingerprint.trim();

  if (matches) {
    return { valid: true, message: "Export file verified. It was generated using the current System Export Password." };
  }

  return {
    valid: false,
    message: "This export file is invalid or was not generated using the current System Export Password.",
  };
}
