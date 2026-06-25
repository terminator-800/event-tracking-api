import { pool } from "../../config/db";
import { Role } from "../../types/express";
import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  deriveDepartmentCode,
  isDepartmentExcludedFromImport,
  normalizeDepartmentLookupKey,
} from "../../models/departments.model";

interface RegisterPayload {
  department: string;
  fullName: string;
  major: string;
  password: string;
  role: Role;
  username: string;
}

interface UpdateUserPayload {
  fullName?: string;
  username?: string;
  password?: string;
}

interface FailResult {
  success: false;
  status: number;
  message: string;
}

interface SuccessResult {
  success: true;
  status: number;
}

type ServiceResult = FailResult | SuccessResult;

interface ResolvedIds {
  departmentId: number | null;
  programId: number | null;
}

const GOVERNOR_ROLES: Role[] = [
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
];

// ── DB Helpers ────────────────────────────────────────────────────────────────

async function isUsernameTaken(username: string): Promise<boolean> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM users WHERE username = ?`,
    [username]
  );
  return rows.length > 0;
}

async function findDepartmentId(department: string): Promise<number | null> {
  const trimmed = department.trim();
  if (!trimmed) return null;

  const [exactRows]: any = await pool.execute(
    `SELECT id FROM departments WHERE name = ? OR code = ? LIMIT 1`,
    [trimmed, trimmed],
  );
  if (exactRows.length > 0) return Number(exactRows[0].id);

  const normalized = normalizeDepartmentLookupKey(trimmed);
  const [nameRows]: any = await pool.execute(
    `SELECT id FROM departments WHERE LOWER(TRIM(name)) = ? LIMIT 1`,
    [normalized],
  );
  if (nameRows.length > 0) return Number(nameRows[0].id);

  const code = deriveDepartmentCode(trimmed);
  if (code) {
    const [codeRows]: any = await pool.execute(
      `SELECT id FROM departments WHERE code = ? LIMIT 1`,
      [code],
    );
    if (codeRows.length > 0) return Number(codeRows[0].id);
  }

  return null;
}

async function findProgramId(major: string, departmentId: number): Promise<number | null> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM programs WHERE (course_name = ? OR course_code = ?) AND department_id = ?`,
    [major, major, departmentId]
  );
  return rows.length === 0 ? null : rows[0].id;
}

// ── Role Resolvers ────────────────────────────────────────────────────────────

async function resolveCSGPresidentIds(): Promise<FailResult | ResolvedIds> {
  return { departmentId: null, programId: null };
}

async function resolveGovernorIds(department: string, major: string): Promise<FailResult | ResolvedIds> {
  if (!department) {
    return { success: false, status: 400, message: "Governor must have a department." };
  }

  const departmentId = await findDepartmentId(department);
  if (!departmentId) {
    return { success: false, status: 404, message: "Department not found." };
  }

  let programId: number | null = null;
  if (major) {
    programId = await findProgramId(major, departmentId);
    if (!programId) {
      return { success: false, status: 404, message: "Major/program not found in that department." };
    }
  }

  return { departmentId, programId };
}

async function insertUser(
  username: string,
  fullName: string,
  hashedPassword: string,
  role: Role,
  studentId: number | null,
  departmentId: number | null,
  programId: number | null
): Promise<void> {
  await pool.execute(
    `INSERT INTO users (username, full_name, password, role, student_id, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, fullName, hashedPassword, role, studentId, departmentId, programId]
  );
}

// ── Main Service ──────────────────────────────────────────────────────────────

export async function createUser(payload: RegisterPayload): Promise<ServiceResult> {
  const { department, fullName, major, password, role, username } = payload;
  const csg_president = "csg_president";
  try {

    if (await isUsernameTaken(username)) {
      return { success: false, status: 409, message: "Username already exists." };
    }

    let departmentId: number | null = null;
    let programId: number | null = null;
    let studentId: number | null = null;

    if (role === csg_president) {
      const resolved = await resolveCSGPresidentIds();
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);

    } else if (GOVERNOR_ROLES.includes(role)) {
      const resolved = await resolveGovernorIds(department, major);
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await insertUser(username, fullName, hashedPassword, role, studentId, departmentId, programId);

    return { success: true, status: 201 };

  } catch (error) {
    console.error("createUser error:", error);
    return { success: false, status: 500, message: "Internal server error." };
  }
}

export async function listDepartments() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, code FROM departments ORDER BY name ASC`,
  );
  return rows
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? "").trim(),
      code: String(row.code ?? "").trim(),
    }))
    .filter((row) => row.name && !isDepartmentExcludedFromImport(row.name));
}

export async function listUsers() {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 
      u.id,
      u.username,
      u.full_name,
      u.role,
      u.student_id,
      u.department_id,
      d.name AS department_name,
      u.program_id,
      u.created_at,
      u.updated_at
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.id DESC`,
  );
  return rows;
}

export async function updateUserById(userId: number, payload: UpdateUserPayload): Promise<ServiceResult> {
  const { fullName, username, password } = payload;
  if (!fullName && !username && !password) {
    return { success: false, status: 400, message: "Nothing to update." };
  }

  const [existingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (existingRows.length === 0) {
    return { success: false, status: 404, message: "User not found." };
  }

  if (username) {
    const [usernameRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1`,
      [username, userId],
    );
    if (usernameRows.length > 0) {
      return { success: false, status: 409, message: "Username already exists." };
    }
  }

  const updates: string[] = [];
  const values: Array<string | number> = [];

  if (fullName !== undefined) {
    updates.push("full_name = ?");
    values.push(fullName);
  }

  if (username) {
    updates.push("username = ?");
    values.push(username);
  }

  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    updates.push("password = ?");
    values.push(hashedPassword);
  }

  values.push(userId);
  await pool.execute(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

  return { success: true, status: 200 };
}

export async function deleteUserById(userId: number): Promise<ServiceResult> {
  const [result] = await pool.execute<ResultSetHeader>(`DELETE FROM users WHERE id = ?`, [userId]);
  if (result.affectedRows === 0) {
    return { success: false, status: 404, message: "User not found." };
  }
  return { success: true, status: 200 };
}