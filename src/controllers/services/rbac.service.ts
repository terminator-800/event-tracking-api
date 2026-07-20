import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../config/db";
import type { Role } from "../../types/express";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  LEGACY_PERMISSION_ALIASES,
  PERMISSION_CATALOG,
  PERMISSION_MODULE_ORDER,
  RBAC_ROLES,
} from "../../models/role_permissions.model";

export type RolePermissionMatrix = Record<string, Record<string, boolean>>;

function expandWithLegacyAliases(keys: string[]): string[] {
  const set = new Set(keys);
  for (const [legacy, implied] of Object.entries(LEGACY_PERMISSION_ALIASES)) {
    if (set.has(legacy)) {
      for (const key of implied) set.add(key);
    }
  }
  return [...set];
}

export async function getPermissionsForRole(role: string): Promise<string[]> {
  const normalized = String(role ?? "").toLowerCase().trim() as Role;
  if (normalized === "super_admin") {
    return [...ALL_PERMISSION_KEYS];
  }

  // Legacy per-college governors share the unified governor matrix.
  const lookupRole =
    normalized === "it_governor" ||
    normalized === "cba_governor" ||
    normalized === "ceas_governor" ||
    normalized === "coc_governor" ||
    normalized === "chm_governor"
      ? "governor"
      : normalized;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT permission_key FROM role_permissions WHERE role = ? AND enabled = 1`,
    [lookupRole],
  );

  if (!rows.length) {
    return [...(DEFAULT_ROLE_PERMISSIONS[lookupRole] ?? [])];
  }

  const fromDb = rows.map((r) => String(r.permission_key));
  return expandWithLegacyAliases(fromDb).filter(
    (k) => ALL_PERMISSION_KEYS.includes(k) || k in LEGACY_PERMISSION_ALIASES,
  );
}

export async function roleHasPermission(role: string, permissionKey: string): Promise<boolean> {
  const normalized = String(role ?? "").toLowerCase().trim();
  if (normalized === "super_admin") return true;
  const perms = await getPermissionsForRole(normalized);
  if (perms.includes(permissionKey)) return true;

  // Accept legacy umbrella keys when checking a modern key.
  for (const [legacy, implied] of Object.entries(LEGACY_PERMISSION_ALIASES)) {
    if (implied.includes(permissionKey) && perms.includes(legacy)) return true;
  }
  return false;
}

export async function getRolePermissionMatrix(): Promise<{
  catalog: typeof PERMISSION_CATALOG;
  modules: readonly string[];
  roles: Role[];
  matrix: RolePermissionMatrix;
}> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT role, permission_key, enabled FROM role_permissions`,
  );

  const matrix: RolePermissionMatrix = {};
  for (const role of RBAC_ROLES) {
    matrix[role] = {};
    for (const key of ALL_PERMISSION_KEYS) {
      matrix[role][key] = (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes(key);
    }
  }

  for (const row of rows) {
    const role = String(row.role);
    const key = String(row.permission_key);
    if (!matrix[role]) matrix[role] = {};
    // Only apply known catalog keys into the editable matrix.
    if (!ALL_PERMISSION_KEYS.includes(key)) {
      // Expand legacy umbrella into modern keys when enabled.
      const implied = LEGACY_PERMISSION_ALIASES[key];
      if (implied && Number(row.enabled) === 1) {
        for (const modern of implied) {
          if (matrix[role][modern] === undefined) continue;
          matrix[role][modern] = true;
        }
      }
      continue;
    }
    matrix[role][key] = Number(row.enabled) === 1;
  }

  // Super admin always has everything in the matrix view.
  for (const key of ALL_PERMISSION_KEYS) {
    matrix.super_admin[key] = true;
  }

  return {
    catalog: PERMISSION_CATALOG,
    modules: PERMISSION_MODULE_ORDER,
    roles: RBAC_ROLES,
    matrix,
  };
}

export async function saveRolePermissionMatrix(
  updates: Array<{ role: string; permission_key: string; enabled: boolean }>,
): Promise<{ success: true; status: 200 } | { success: false; status: number; message: string }> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: false, status: 400, message: "No permission updates provided." };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of updates) {
      const role = String(item.role ?? "").toLowerCase().trim();
      const key = String(item.permission_key ?? "").trim();
      if (!RBAC_ROLES.includes(role as Role)) continue;
      if (!ALL_PERMISSION_KEYS.includes(key)) continue;
      // Never strip Super Admin permissions.
      if (role === "super_admin") continue;
      const enabled = item.enabled ? 1 : 0;
      await conn.execute<ResultSetHeader>(
        `INSERT INTO role_permissions (role, permission_key, enabled)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
        [role, key, enabled],
      );
    }
    await conn.commit();
    return { success: true, status: 200 };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
