// controllers/services/user.service.ts

import { pool } from "../../config/db";
import { Role } from "../../types/express";
import bcrypt from "bcrypt";

interface RegisterPayload {
  department: string;
  email: string;
  major: string;
  password: string;
  role: Role;
  username: string;
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

async function findStudentByEmail(email: string) {
  const [rows]: any = await pool.execute(
    `SELECT id FROM students WHERE email = ?`,
    [email]
  );
  return rows.length === 0 ? null : rows[0];
}

async function isUsernameTaken(username: string): Promise<boolean> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM users WHERE username = ?`,
    [username]
  );
  return rows.length > 0;
}

async function hasExistingAccount(studentId: number): Promise<boolean> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM users WHERE student_id = ?`,
    [studentId]
  );
  return rows.length > 0;
}

async function findDepartmentId(department: string): Promise<number | null> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM departments WHERE name = ? OR code = ?`,
    [department, department]
  );
  return rows.length === 0 ? null : rows[0].id;
}

async function findProgramId(major: string, departmentId: number): Promise<number | null> {
  const [rows]: any = await pool.execute(
    `SELECT id FROM programs WHERE (course_name = ? OR course_code = ?) AND department_id = ?`,
    [major, major, departmentId]
  );
  return rows.length === 0 ? null : rows[0].id;
}

async function getDepartmentIdByStudentId(studentId: number): Promise<number | null> {
  const [rows]: any = await pool.execute(
    `SELECT p.department_id
     FROM enrollments e
     JOIN programs p ON e.program_id = p.id
     WHERE e.student_id = ?
     LIMIT 1`,
    [studentId]
  );
  return rows.length === 0 ? null : rows[0].department_id;
}

// ── Role Resolvers ────────────────────────────────────────────────────────────

async function resolveCSGPresidentIds(studentId: number): Promise<FailResult | ResolvedIds> {
  const departmentId = await getDepartmentIdByStudentId(studentId);
  if (!departmentId) {
    return { success: false, status: 404, message: "No enrollment record found for this student." };
  }
  return { departmentId, programId: null };
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
  hashedPassword: string,
  role: Role,
  studentId: number,
  departmentId: number | null,
  programId: number | null
): Promise<void> {
  await pool.execute(
    `INSERT INTO users (username, password, role, student_id, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, hashedPassword, role, studentId, departmentId, programId]
  );
}

// ── Main Service ──────────────────────────────────────────────────────────────

export async function createUser(payload: RegisterPayload): Promise<ServiceResult> {
  const { department, email, major, password, role, username } = payload;
  const csg_president = "csg_president";
  try {

    const student = await findStudentByEmail(email);
    if (!student) {
      return { success: false, status: 404, message: "No student record found with that email." };
    }

    if (await isUsernameTaken(username)) {
      return { success: false, status: 409, message: "Username already exists." };
    }

    if (await hasExistingAccount(student.id)) {
      return { success: false, status: 409, message: "Student already has an account." };
    }

    let departmentId: number | null = null;
    let programId: number | null = null;

    if (role === csg_president) {
      const resolved = await resolveCSGPresidentIds(student.id);
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);

    } else if (GOVERNOR_ROLES.includes(role)) {
      const resolved = await resolveGovernorIds(department, major);
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await insertUser(username, hashedPassword, role, student.id, departmentId, programId);

    return { success: true, status: 201 };

  } catch (error) {
    console.error("createUser error:", error);
    return { success: false, status: 500, message: "Internal server error." };
  }
}