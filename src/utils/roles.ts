import type { Role } from "../types/express";

/** Single governor role — department scope comes from users.department_id. */
export const GOVERNOR_ROLE: Role = "governor";

/** Legacy per-college roles (migrated to `governor` on startup). */
export const LEGACY_GOVERNOR_ROLES = [
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
] as const;

export type LegacyGovernorRole = (typeof LEGACY_GOVERNOR_ROLES)[number];

export const ALL_GOVERNOR_ROLE_VALUES = [GOVERNOR_ROLE, ...LEGACY_GOVERNOR_ROLES] as const;

export function isGovernorRole(role: unknown): boolean {
  const n = String(role ?? "")
    .trim()
    .toLowerCase();
  return (ALL_GOVERNOR_ROLE_VALUES as readonly string[]).includes(n);
}

export function isAnyCashierRole(role: unknown): boolean {
  const n = String(role ?? "")
    .trim()
    .toLowerCase();
  return n === "cashier" || n === "csg_cashier" || n === "dept_cashier";
}

export function isDeptCashierRole(
  role: unknown,
  departmentId?: number | null,
): boolean {
  const n = String(role ?? "")
    .trim()
    .toLowerCase();
  if (n === "dept_cashier") return true;
  return n === "cashier" && departmentId != null && Number.isFinite(Number(departmentId));
}

/** CSG Cashier — institution CSG desk; sees CSG President–created events. */
export function isCsgCashierRole(
  role: unknown,
  departmentId?: number | null,
): boolean {
  const n = String(role ?? "")
    .trim()
    .toLowerCase();
  if (n === "csg_cashier") return true;
  return n === "cashier" && !isDeptCashierRole(role, departmentId);
}

/** SQL fragment: event creators who are CSG presidents (`alias` defaults to `e`). */
export function sqlCsgPresidentCreator(alias = "e"): string {
  return `${alias}.created_by IN (SELECT cu.id FROM users cu WHERE cu.role = 'csg_president')`;
}

/** SQL: event creators who are CSG presidents (events table alias `e`). */
export const SQL_CSG_PRESIDENT_CREATOR = sqlCsgPresidentCreator("e");

/** Roles allowed on operational desk routes (events, payments, etc.). */
export const OPERATIONAL_ROLES = [
  "admin",
  "super_admin",
  "csg_president",
  GOVERNOR_ROLE,
  "cashier",
  "csg_cashier",
  "dept_cashier",
  ...LEGACY_GOVERNOR_ROLES,
] as const;

export const STAFF_ROLES = [...OPERATIONAL_ROLES] as const;
