import type { Role } from "../types/express";

export const GOVERNOR_ROLES = [
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
] as const satisfies readonly Role[];

export const OPERATIONAL_DESK_ROLES = [
  "super_admin",
  "admin",
  "csg_president",
  ...GOVERNOR_ROLES,
] as const satisfies readonly Role[];

export const INSTITUTION_ADMIN_ROLES = ["admin", "super_admin"] as const satisfies readonly Role[];

export const INSTITUTION_OR_CSG_ROLES = [
  "admin",
  "super_admin",
  "csg_president",
] as const satisfies readonly Role[];

export function isSuperAdminRole(role: Role | undefined | null): boolean {
  return role === "super_admin";
}

export function isAdminRole(role: Role | undefined | null): boolean {
  return role === "admin";
}

export function hasInstitutionAdminAccess(role: Role | undefined | null): boolean {
  return isAdminRole(role) || isSuperAdminRole(role);
}
