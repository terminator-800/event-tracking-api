import { pool } from "../config/db";

/**
 * CSV import → departments table (all optional):
 *   Department  → name (stored as written in CSV)
 *
 * Alias groups share the same department code for lookup only:
 *   CEAS — College of Teacher Education / College of Education, Arts and Sciences
 *   CCJE — College of Criminology / College of Criminal Justice Education
 *
 * Departments excluded from student CSV import (not inserted).
 */

/** Department → name */
export const DEPARTMENTS_CSV_DEPARTMENT_HEADERS = [
  "department",
  "dept",
  "department name",
  "college",
] as const;

/** Skipped entirely on import — no student, enrollment, or department row created. */
export const DEPARTMENTS_EXCLUDED_FROM_IMPORT = ["graduate school"] as const;

/** Lookup key (lowercase) → department code. Multiple names can share one code. */
export const DEPARTMENT_CODE_BY_LOOKUP_KEY: Record<string, string> = {
  "college of information technology": "CIT",
  "college of business administration": "CBA",
  "college of education, arts and sciences": "CEAS",
  "college of teacher education": "CEAS",
  "college of criminology": "CCJE",
  "college of criminal justice education": "CCJE",
  "college of hospitality management": "CHM",
};

export function normalizeDepartmentLookupKey(departmentName: string): string {
  return departmentName
    .trim()
    .toLowerCase()
    .replace(/,\s+and\b/g, " and")
    .replace(/\s+/g, " ");
}

/** Keeps the CSV department label; does not rename to a canonical display name. */
export function resolveDepartmentNameForImport(departmentNameRaw: string): string {
  return departmentNameRaw.trim();
}

export function deriveDepartmentCode(departmentName: string): string {
  const normalized = normalizeDepartmentLookupKey(departmentName);
  if (DEPARTMENT_CODE_BY_LOOKUP_KEY[normalized]) return DEPARTMENT_CODE_BY_LOOKUP_KEY[normalized];
  const words = departmentName.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "DEPT";
  return words.map((word) => word[0].toUpperCase()).join("").slice(0, 20);
}

export function isDepartmentExcludedFromImport(departmentName: string): boolean {
  const normalized = normalizeDepartmentLookupKey(departmentName);
  if (!normalized) return false;
  return DEPARTMENTS_EXCLUDED_FROM_IMPORT.includes(
    normalized as (typeof DEPARTMENTS_EXCLUDED_FROM_IMPORT)[number],
  );
}

export async function createDepartmentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      code VARCHAR(20) NOT NULL UNIQUE
    )
  `);
}
