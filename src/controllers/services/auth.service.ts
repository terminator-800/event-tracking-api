import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { UserRepository } from "../../repositories/users.repository";
import { env } from "../../config/env";
import { Response } from "express";
import { pool } from "../../config/db";
import { encryptValue } from "./export-security.service";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const userRepository = new UserRepository();
export const MIN_ACCOUNT_PASSWORD_LENGTH = 6;

export async function verifyUserCredentials(
  username: string,
  password: string
): Promise<{ id: number; username: string; role: string, department_id: number | null } | null> {
  
  const user = await userRepository.findByUsername(username);
  if (!user) return null;

  const match = await bcrypt.compare(password, user.password);
  if (!match) return null;

  return user;
}

export async function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const current = String(currentPassword ?? "");
  const next = String(newPassword ?? "").trim();

  if (!current) {
    return { ok: false, status: 400, message: "Current password is required." };
  }
  if (next.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
    return {
      ok: false,
      status: 400,
      message: `New password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`,
    };
  }
  if (current === next) {
    return { ok: false, status: 400, message: "New password must be different from the current password." };
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, password FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (!rows.length) {
    return { ok: false, status: 404, message: "User not found." };
  }

  const match = await bcrypt.compare(current, String(rows[0].password ?? ""));
  if (!match) {
    return { ok: false, status: 401, message: "Current password is incorrect." };
  }

  const hashedPassword = await bcrypt.hash(next, 10);
  const encryptedPassword = encryptValue(next);
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET password = ?, password_encrypted = ? WHERE id = ?`,
    [hashedPassword, encryptedPassword, userId],
  );

  return { ok: true };
}

export function generateAuthToken(user: { id: number; username: string; role: string; department_id?: number | null }) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, department_id: user.department_id ?? null },
    env.jwtSecret,
    { expiresIn: "7d" }
  );
}

/** Dept homepage sign-in: include full user identity so governors can use attendance/dashboard APIs over httpOnly cookies. */
export function generateDepartmentToken(payload: {
  id: number;
  username: string;
  role: string;
  department_id: number;
  department_name: string;
  department_code: string;
}) {
  return jwt.sign(
    {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      department_id: payload.department_id,
      department_name: payload.department_name,
      department_code: payload.department_code,
    },
    env.jwtSecret,
    { expiresIn: "7d" },
  );
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
