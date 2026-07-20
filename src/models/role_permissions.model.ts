import { pool } from "../config/db";
import type { Role } from "../types/express";

export type PermissionDefinition = {
  key: string;
  label: string;
  /** Module heading shown in Role Permissions UI */
  module: string;
  description?: string;
};

/**
 * Canonical permission catalog grouped by module.
 * Keys remain stable for nav/action checks across API + client.
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // Dashboard
  { key: "nav.dashboard", label: "View", module: "Dashboard" },

  // Event Management
  { key: "nav.manage_event.list", label: "View", module: "Event Management" },
  { key: "action.event.create", label: "Create", module: "Event Management" },
  { key: "action.event.edit", label: "Edit", module: "Event Management" },
  { key: "action.event.delete", label: "Delete", module: "Event Management" },
  { key: "action.event.export_config", label: "Export Config", module: "Event Management" },
  { key: "action.event.import_config", label: "Import Config", module: "Event Management" },
  { key: "action.event.export_attendance", label: "Export Attendance", module: "Event Management" },
  { key: "action.event.import_attendance", label: "Import Attendance", module: "Event Management" },

  // Attendance Management (Reports → Attendance)
  { key: "nav.reports.attendance", label: "View", module: "Attendance Management" },
  { key: "action.attendance.export", label: "Export", module: "Attendance Management" },
  { key: "action.attendance.import", label: "Import", module: "Attendance Management" },
  { key: "action.attendance.print", label: "Print", module: "Attendance Management" },

  // Students
  { key: "nav.reports.students", label: "View", module: "Students" },
  { key: "action.students.export", label: "Export", module: "Students" },
  { key: "action.students.print", label: "Print", module: "Students" },

  // Collection (Reports → Collection)
  { key: "nav.reports.collection", label: "View", module: "Collection" },
  { key: "action.collection.export", label: "Export", module: "Collection" },
  { key: "action.collection.print", label: "Print", module: "Collection" },

  // Cashier
  { key: "nav.cashier.payments", label: "View Payments", module: "Cashier" },
  { key: "nav.cashier.station", label: "Payment Station", module: "Cashier" },
  { key: "action.payment.record", label: "Record Payment", module: "Cashier" },

  // Import (student CSV)
  { key: "nav.import", label: "View", module: "Import" },
  { key: "action.import.csv", label: "Import CSV", module: "Import" },
  { key: "action.import.reset", label: "Data Reset", module: "Import" },

  // Users
  { key: "nav.users", label: "View", module: "Users" },
  { key: "nav.users.list", label: "List Page", module: "Users" },
  { key: "action.users.manage", label: "Create / Edit / Delete", module: "Users" },

  // Settings
  { key: "nav.settings.role", label: "Role", module: "Settings" },
  { key: "nav.settings.school_year", label: "School Year", module: "Settings" },
  { key: "action.academic_period.manage", label: "Manage Periods", module: "Settings" },
  { key: "nav.settings.audit_logs", label: "Audit Logs", module: "Settings" },
  { key: "nav.settings.reports_analytics", label: "Reports & Analytics", module: "Settings" },
  { key: "nav.settings.export_security", label: "Export Security", module: "Settings" },
  {
    key: "action.rbac.manage",
    label: "Configure Permissions",
    module: "Settings",
    description: "Always available to Super Admin.",
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** Ordered module titles for UI. */
export const PERMISSION_MODULE_ORDER = [
  "Dashboard",
  "Event Management",
  "Attendance Management",
  "Students",
  "Collection",
  "Cashier",
  "Import",
  "Users",
  "Settings",
] as const;

export const RBAC_ROLES: Role[] = [
  "super_admin",
  "admin",
  "csg_president",
  "governor",
  "cashier",
];

const CASHIER_DEFAULTS = [
  "nav.dashboard",
  "nav.cashier.payments",
  "nav.cashier.station",
  "nav.reports.collection",
  "action.payment.record",
  "action.collection.export",
  "action.collection.print",
] as const;

const GOVERNOR_DEFAULTS = [
  "nav.dashboard",
  "nav.manage_event.list",
  "nav.cashier.payments",
  "nav.cashier.station",
  "nav.reports.attendance",
  "nav.reports.students",
  "nav.reports.collection",
  "action.event.create",
  "action.event.edit",
  "action.event.delete",
  "action.event.export_config",
  "action.event.export_attendance",
  "action.event.import_attendance",
  "action.attendance.export",
  "action.attendance.print",
  "action.students.export",
  "action.students.print",
  "action.payment.record",
  "action.collection.export",
  "action.collection.print",
] as const;

/** Default enabled permissions by role (mirrors previous hard-coded access). */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: ALL_PERMISSION_KEYS,
  admin: [
    "nav.dashboard",
    "nav.manage_event.list",
    "nav.cashier.payments",
    "nav.cashier.station",
    "nav.reports.attendance",
    "nav.reports.students",
    "nav.reports.collection",
    "nav.import",
    "nav.users",
    "action.event.create",
    "action.event.edit",
    "action.event.delete",
    "action.event.export_config",
    "action.event.import_config",
    "action.event.export_attendance",
    "action.event.import_attendance",
    "action.attendance.export",
    "action.attendance.import",
    "action.attendance.print",
    "action.students.export",
    "action.students.print",
    "action.payment.record",
    "action.collection.export",
    "action.collection.print",
    "action.users.manage",
    "action.import.csv",
    "action.import.reset",
  ],
  csg_president: [
    "nav.dashboard",
    "nav.manage_event.list",
    "nav.cashier.payments",
    "nav.cashier.station",
    "nav.reports.attendance",
    "nav.reports.students",
    "nav.reports.collection",
    "nav.settings.export_security",
    "action.event.create",
    "action.event.edit",
    "action.event.delete",
    "action.event.export_config",
    "action.event.import_config",
    "action.event.export_attendance",
    "action.event.import_attendance",
    "action.attendance.export",
    "action.attendance.import",
    "action.attendance.print",
    "action.students.export",
    "action.students.print",
    "action.payment.record",
    "action.collection.export",
    "action.collection.print",
  ],
  governor: [...GOVERNOR_DEFAULTS],
  cashier: [...CASHIER_DEFAULTS],
};

/**
 * Legacy keys that may still exist in DB from earlier RBAC seeds.
 * When present and enabled, they imply the listed modern keys.
 */
export const LEGACY_PERMISSION_ALIASES: Record<string, readonly string[]> = {
  "action.event.export": [
    "action.event.export_config",
    "action.event.export_attendance",
    "action.event.import_config",
    "action.event.import_attendance",
  ],
  "nav.manage_event.create": ["action.event.create"],
};

export async function createRolePermissionsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      role VARCHAR(40) NOT NULL,
      permission_key VARCHAR(120) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_role_permission (role, permission_key),
      INDEX idx_role_permissions_role (role)
    )
  `);

  await seedDefaultRolePermissions();
}

async function seedDefaultRolePermissions(): Promise<void> {
  // Merge any legacy per-college governor permission rows into unified `governor`.
  try {
    await pool.execute(`
      INSERT INTO role_permissions (role, permission_key, enabled)
      SELECT 'governor', permission_key, MAX(enabled)
      FROM role_permissions
      WHERE role IN ('it_governor','cba_governor','ceas_governor','coc_governor','chm_governor')
      GROUP BY permission_key
      ON DUPLICATE KEY UPDATE enabled = GREATEST(role_permissions.enabled, VALUES(enabled))
    `);
    await pool.execute(`
      DELETE FROM role_permissions
      WHERE role IN ('it_governor','cba_governor','ceas_governor','coc_governor','chm_governor')
    `);
  } catch (error) {
    console.warn("[role_permissions] Could not merge legacy governor rows:", error);
  }

  for (const role of RBAC_ROLES) {
    const enabledSet = new Set(DEFAULT_ROLE_PERMISSIONS[role] ?? []);
    for (const key of ALL_PERMISSION_KEYS) {
      const enabled = enabledSet.has(key) ? 1 : 0;
      await pool.execute(
        `INSERT IGNORE INTO role_permissions (role, permission_key, enabled)
         VALUES (?, ?, ?)`,
        [role, key, enabled],
      );
    }
  }
}
