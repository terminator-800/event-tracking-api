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

/** Roles allowed on operational desk routes (events, payments, etc.). */
export const OPERATIONAL_ROLES = [
  "admin",
  "super_admin",
  "csg_president",
  GOVERNOR_ROLE,
  "cashier",
  ...LEGACY_GOVERNOR_ROLES,
] as const;

export const STAFF_ROLES = [...OPERATIONAL_ROLES] as const;
