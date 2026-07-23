import { pool } from "../../config/db";
import { Role } from "../../types/express";
import bcrypt from "bcrypt";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  deriveDepartmentCode,
  isDepartmentExcludedFromImport,
  normalizeDepartmentLookupKey,
} from "../../models/departments.model";
import { GOVERNOR_ROLE, isGovernorRole } from "../../utils/roles";
import { decryptValue, encryptValue } from "./export-security.service";

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
  role?: Role;
  department?: string;
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

/** Dept Cashier: department required. CSG Cashier: empty department → institution-wide. */
async function resolveCashierIds(
  department: string,
  requireDepartment: boolean,
): Promise<FailResult | ResolvedIds> {
  const trimmed = String(department ?? "").trim();
  if (!trimmed) {
    if (requireDepartment) {
      return { success: false, status: 400, message: "Dept Cashier must have a department." };
    }
    return { departmentId: null, programId: null };
  }
  const departmentId = await findDepartmentId(trimmed);
  if (!departmentId) {
    return { success: false, status: 404, message: "Department not found." };
  }
  return { departmentId, programId: null };
}

function normalizeCashierRole(
  role: Role,
  departmentId: number | null,
): "csg_cashier" | "dept_cashier" {
  if (role === "dept_cashier") return "dept_cashier";
  if (role === "csg_cashier") return "csg_cashier";
  // Legacy `cashier`
  return departmentId != null ? "dept_cashier" : "csg_cashier";
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
  encryptedPassword: string,
  role: Role,
  studentId: number | null,
  departmentId: number | null,
  programId: number | null
): Promise<void> {
  await pool.execute(
    `INSERT INTO users (username, full_name, password, password_encrypted, role, student_id, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, fullName, hashedPassword, encryptedPassword, role, studentId, departmentId, programId]
  );
}

// ── Main Service ──────────────────────────────────────────────────────────────

export async function createUser(payload: RegisterPayload): Promise<ServiceResult> {
  const { department, fullName, major, password, username } = payload;
  let { role } = payload;
  try {

    if (await isUsernameTaken(username)) {
      return { success: false, status: 409, message: "Username already exists." };
    }

    let departmentId: number | null = null;
    let programId: number | null = null;
    let studentId: number | null = null;

    if (role === "csg_president") {
      const resolved = await resolveCSGPresidentIds();
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);

    } else if (role === "cashier" || role === "csg_cashier" || role === "dept_cashier") {
      const requireDepartment = role === "dept_cashier";
      const resolved = await resolveCashierIds(department, requireDepartment);
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);
      role = normalizeCashierRole(role, departmentId);

    } else if (isGovernorRole(role)) {
      const resolved = await resolveGovernorIds(department, major);
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);
      role = GOVERNOR_ROLE;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const encryptedPassword = encryptValue(password);

    await insertUser(username, fullName, hashedPassword, encryptedPassword, role, studentId, departmentId, programId);

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

export function filterUsersForRole<T extends { role?: string | null }>(users: T[], requesterRole?: Role | null): T[] {
  const requester = String(requesterRole ?? "")
    .trim()
    .toLowerCase();

  if (!requester || requester === "super_admin") {
    return users;
  }

  const isHiddenForRequester = (rawRole: string | null | undefined): boolean => {
    const role = String(rawRole ?? "")
      .trim()
      .toLowerCase();
    if (requester === "admin") {
      return role === "super_admin";
    }
    // CSG, governor (incl. legacy), cashier — hide admin and super admin accounts
    if (
      requester === "csg_president" ||
      requester === "cashier" ||
      requester === "csg_cashier" ||
      requester === "dept_cashier" ||
      isGovernorRole(requester)
    ) {
      return role === "super_admin" || role === "admin";
    }
    return false;
  };

  return users.filter((user) => !isHiddenForRequester(user.role));
}

export async function listUsers(requesterRole?: Role | null) {
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
  return filterUsersForRole(rows as Array<{ role?: string | null }>, requesterRole);
}

const ASSIGNABLE_ROLES: Role[] = [
  "super_admin",
  "admin",
  "csg_president",
  GOVERNOR_ROLE,
  "cashier",
  "csg_cashier",
  "dept_cashier",
];

export async function updateUserById(userId: number, payload: UpdateUserPayload): Promise<ServiceResult> {
  const { fullName, username, password, role: rawRole, department } = payload;
  if (!fullName && !username && !password && rawRole === undefined) {
    return { success: false, status: 400, message: "Nothing to update." };
  }

  const [existingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, role, department_id FROM users WHERE id = ? LIMIT 1`,
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

  const role =
    rawRole !== undefined && isGovernorRole(rawRole) ? GOVERNOR_ROLE : rawRole;

  if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
    return { success: false, status: 400, message: "Invalid role." };
  }

  const updates: string[] = [];
  const values: Array<string | number | null> = [];

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
    updates.push("password_encrypted = ?");
    values.push(encryptValue(password));
  }

  if (role !== undefined) {
    let departmentId: number | null = null;
    let programId: number | null = null;
    let nextRole: Role = role;

    if (role === "csg_president") {
      const resolved = await resolveCSGPresidentIds();
      if ("success" in resolved) return resolved;
      ({ departmentId, programId } = resolved);
    } else if (role === "cashier" || role === "csg_cashier" || role === "dept_cashier") {
      if (department !== undefined) {
        const resolved = await resolveCashierIds(department ?? "", role === "dept_cashier");
        if ("success" in resolved) return resolved;
        ({ departmentId, programId } = resolved);
      } else {
        const existingDept = existingRows[0].department_id;
        departmentId = existingDept != null ? Number(existingDept) : null;
        programId = null;
        if (role === "dept_cashier" && departmentId == null) {
          return {
            success: false,
            status: 400,
            message: "Dept Cashier must have a department. Select a college for this user.",
          };
        }
        if (role === "csg_cashier") {
          departmentId = null;
        }
      }
      nextRole = normalizeCashierRole(role, departmentId);
    } else if (isGovernorRole(role)) {
      if (department?.trim()) {
        const resolved = await resolveGovernorIds(department, "");
        if ("success" in resolved) return resolved;
        ({ departmentId, programId } = resolved);
      } else {
        const existingDept = existingRows[0].department_id;
        departmentId = existingDept != null ? Number(existingDept) : null;
        if (departmentId == null) {
          return {
            success: false,
            status: 400,
            message: "Governor must have a department. Select a college for this user.",
          };
        }
        programId = null;
      }
      nextRole = GOVERNOR_ROLE;
    } else {
      departmentId = null;
      programId = null;
    }

    updates.push("role = ?");
    values.push(nextRole);
    updates.push("department_id = ?");
    values.push(departmentId);
    updates.push("program_id = ?");
    values.push(programId);
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

export async function getSuperAdminStats() {
  const [[userStats]] = await pool.execute<RowDataPacket[]>(`
    SELECT
      COUNT(*) AS total_users,
      SUM(role = 'admin') AS total_admins,
      SUM(role = 'super_admin') AS total_super_admins,
      SUM(role = 'csg_president') AS total_csg_presidents,
      SUM(role IN ('governor','it_governor','cba_governor','ceas_governor','coc_governor','chm_governor')) AS total_governors
    FROM users
  `);

  const [[eventStats]] = await pool.execute<RowDataPacket[]>(`
    SELECT
      COUNT(*) AS total_events,
      SUM(status = 'upcoming') AS upcoming_events,
      SUM(status = 'active') AS active_events,
      SUM(status = 'completed') AS completed_events
    FROM events
  `);

  const [[studentStats]] = await pool.execute<RowDataPacket[]>(`
    SELECT COUNT(*) AS total_students FROM students
  `);

  const [[paymentStats]] = await pool.execute<RowDataPacket[]>(`
    SELECT
      COUNT(*) AS total_payments,
      COALESCE(SUM(amount), 0) AS total_amount_collected
    FROM payments
    WHERE status = 'paid'
  `).catch(() => [[{ total_payments: 0, total_amount_collected: 0 }]]);

  return {
    users: userStats,
    events: eventStats,
    students: studentStats,
    payments: paymentStats,
  };
}

export async function getAuditLogs() {
  const [recentUsers] = await pool.execute<RowDataPacket[]>(`
    SELECT
      u.id,
      'user_created' AS action,
      CONCAT('User "', u.username, '" (', u.role, ') was created') AS description,
      u.created_at AS timestamp,
      'system' AS performed_by
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT 50
  `);

  const [recentEvents] = await pool.execute<RowDataPacket[]>(`
    SELECT
      e.id,
      'event_created' AS action,
      CONCAT('Event "', e.name, '" was created (status: ', e.status, ')') AS description,
      e.created_at AS timestamp,
      COALESCE(u.username, 'system') AS performed_by
    FROM events e
    LEFT JOIN users u ON u.id = e.created_by
    ORDER BY e.created_at DESC
    LIMIT 50
  `).catch(() => [[]]);

  const combined = [
    ...(Array.isArray(recentUsers) ? recentUsers : []),
    ...(Array.isArray(recentEvents) ? recentEvents : []),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 100);

  return combined;
}

/** Super Admin only — reveal recoverable account password when encrypted copy exists. */
export async function revealUserAccountPassword(userId: number): Promise<{
  success: boolean;
  status: number;
  message?: string;
  password?: string | null;
  recoverable?: boolean;
}> {
  if (!Number.isFinite(userId) || userId <= 0) {
    return { success: false, status: 400, message: "Invalid user id." };
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT password_encrypted FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (!rows.length) {
    return { success: false, status: 404, message: "User not found." };
  }
  const encrypted = rows[0].password_encrypted;
  if (!encrypted) {
    return { success: true, status: 200, password: null, recoverable: false };
  }
  try {
    return {
      success: true,
      status: 200,
      password: decryptValue(String(encrypted)),
      recoverable: true,
    };
  } catch {
    return { success: true, status: 200, password: null, recoverable: false };
  }
}