import { pool } from "../config/db";
import type { Role } from "../types/express";
import type { RowDataPacket } from "mysql2";

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

  // Students
  { key: "nav.reports.students", label: "View", module: "Students" },
  { key: "action.students.export", label: "Export", module: "Students" },
  { key: "action.students.print", label: "Print", module: "Students" },
  { key: "action.students.update_rfid", label: "Update RFID", module: "Students" },

  // Reports (sidebar: Event Attendance + Receivables children)
  { key: "nav.reports.attendance", label: "Event Attendance", module: "Reports" },
  { key: "action.attendance.export", label: "Export Attendance", module: "Reports" },
  { key: "action.attendance.import", label: "Import Attendance", module: "Reports" },
  { key: "action.attendance.print", label: "Print Attendance", module: "Reports" },
  { key: "nav.reports.collection.all", label: "Collections", module: "Reports" },
  { key: "nav.reports.collection.paid", label: "Cash Received", module: "Reports" },
  { key: "nav.reports.collection.partial", label: "Partial Payments", module: "Reports" },
  { key: "nav.reports.collection.unpaid", label: "Accounts Receivable", module: "Reports" },
  { key: "action.collection.export", label: "Export Receivables", module: "Reports" },
  { key: "action.collection.print", label: "Print Receivables", module: "Reports" },

  // Cashier
  { key: "nav.cashier.payments", label: "View Payments", module: "Cashier" },
  { key: "nav.cashier.station", label: "Payment Station", module: "Cashier" },
  { key: "action.payment.record", label: "Record Payment", module: "Cashier" },
  { key: "action.payment.delete", label: "Delete Payment", module: "Cashier" },

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
  { key: "nav.settings.backup", label: "Backup", module: "Settings" },
  { key: "nav.settings.update_rfid", label: "Update Student", module: "Settings" },
  { key: "nav.settings.update_password", label: "Update Password", module: "Settings" },
  { key: "action.backup.download", label: "Download Backup", module: "Settings" },
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
  "Students",
  "Reports",
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
  "csg_cashier",
  "dept_cashier",
];

const RECEIVABLES_NAV_KEYS = [
  "nav.reports.collection.all",
  "nav.reports.collection.paid",
  "nav.reports.collection.partial",
  "nav.reports.collection.unpaid",
] as const;

const CASHIER_DEFAULTS = [
  "nav.dashboard",
  "nav.manage_event.list",
  "nav.cashier.payments",
  "nav.cashier.station",
  ...RECEIVABLES_NAV_KEYS,
  "action.payment.record",
  "action.collection.export",
  "action.collection.print",
  "nav.settings.update_password",
] as const;

const DEPT_CASHIER_DEFAULTS = [
  ...CASHIER_DEFAULTS,
  "nav.settings.backup",
  "action.backup.download",
] as const;

const GOVERNOR_DEFAULTS = [
  "nav.dashboard",
  "nav.manage_event.list",
  "nav.cashier.payments",
  "nav.cashier.station",
  "nav.reports.attendance",
  "nav.reports.students",
  ...RECEIVABLES_NAV_KEYS,
  "nav.settings.backup",
  "action.backup.download",
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
  "action.students.update_rfid",
  "action.payment.record",
  "action.collection.export",
  "action.collection.print",
  "nav.settings.update_rfid",
  "nav.settings.update_password",
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
    "nav.reports.collection.all",
    "nav.reports.collection.paid",
    "nav.reports.collection.partial",
    "nav.reports.collection.unpaid",
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
    "action.students.update_rfid",
    "action.payment.record",
    "action.collection.export",
    "action.collection.print",
    "action.users.manage",
    "action.import.csv",
    "action.import.reset",
    "nav.settings.backup",
    "nav.settings.update_rfid",
    "nav.settings.update_password",
    "action.backup.download",
  ],
  csg_president: [
    "nav.dashboard",
    "nav.manage_event.list",
    "nav.cashier.payments",
    "nav.cashier.station",
    "nav.reports.attendance",
    "nav.reports.students",
    "nav.reports.collection.all",
    "nav.reports.collection.paid",
    "nav.reports.collection.partial",
    "nav.reports.collection.unpaid",
    "nav.settings.export_security",
    "nav.settings.backup",
    "nav.settings.update_rfid",
    "nav.settings.update_password",
    "action.backup.download",
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
    "action.students.update_rfid",
    "action.payment.record",
    "action.collection.export",
    "action.collection.print",
  ],
  governor: [...GOVERNOR_DEFAULTS],
  csg_cashier: [...CASHIER_DEFAULTS],
  dept_cashier: [...DEPT_CASHIER_DEFAULTS],
  /** @deprecated legacy — treated as csg_cashier in RBAC lookups */
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
  /** Previous single Receivables key → all report children. */
  "nav.reports.collection": [
    "nav.reports.collection.all",
    "nav.reports.collection.paid",
    "nav.reports.collection.partial",
    "nav.reports.collection.unpaid",
  ],
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

  // Copy legacy `cashier` permission rows onto the split cashier roles (once).
  try {
    for (const target of ["csg_cashier", "dept_cashier"] as const) {
      await pool.execute(
        `
        INSERT INTO role_permissions (role, permission_key, enabled)
        SELECT ?, src.permission_key, src.enabled
        FROM role_permissions AS src
        WHERE src.role = 'cashier'
        ON DUPLICATE KEY UPDATE enabled = GREATEST(role_permissions.enabled, VALUES(enabled))
        `,
        [target],
      );
    }
  } catch (error) {
    console.warn("[role_permissions] Could not copy legacy cashier permissions:", error);
  }

  // Cashiers need List Events to collect against CSG / college events.
  try {
    for (const role of ["csg_cashier", "dept_cashier", "cashier"] as const) {
      await pool.execute(
        `
        INSERT INTO role_permissions (role, permission_key, enabled)
        VALUES (?, 'nav.manage_event.list', 1)
        ON DUPLICATE KEY UPDATE enabled = 1
        `,
        [role],
      );
    }
  } catch (error) {
    console.warn("[role_permissions] Could not enable cashier list-events permission:", error);
  }

  // Semester backup for admin / CSG / department desks.
  try {
    for (const role of ["admin", "csg_president", "governor", "dept_cashier"] as const) {
      for (const key of ["nav.settings.backup", "action.backup.download"] as const) {
        await pool.execute(
          `
          INSERT INTO role_permissions (role, permission_key, enabled)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE enabled = 1
          `,
          [role, key],
        );
      }
    }
  } catch (error) {
    console.warn("[role_permissions] Could not enable backup permissions:", error);
  }

  // Update Student (RFID) for desks that manage student records.
  try {
    for (const role of ["admin", "csg_president", "governor"] as const) {
      for (const key of ["nav.settings.update_rfid", "action.students.update_rfid"] as const) {
        await pool.execute(
          `
          INSERT INTO role_permissions (role, permission_key, enabled)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE enabled = 1
          `,
          [role, key],
        );
      }
    }
  } catch (error) {
    console.warn("[role_permissions] Could not enable update RFID permissions:", error);
  }

  // Update Password — available to all operational desks by default.
  try {
    for (const role of RBAC_ROLES) {
      if (role === "super_admin") continue;
      await pool.execute(
        `
        INSERT INTO role_permissions (role, permission_key, enabled)
        VALUES (?, 'nav.settings.update_password', 1)
        ON DUPLICATE KEY UPDATE enabled = 1
        `,
        [role],
      );
    }
  } catch (error) {
    console.warn("[role_permissions] Could not enable update password permissions:", error);
  }

  // Split legacy Receivables view into Collections / Cash Received / Partial / AR.
  try {
    for (const role of RBAC_ROLES) {
      const [legacyRows] = await pool.execute<RowDataPacket[]>(
        `SELECT enabled FROM role_permissions WHERE role = ? AND permission_key = 'nav.reports.collection' LIMIT 1`,
        [role],
      );
      const legacyOn = legacyRows.length > 0 && Number(legacyRows[0].enabled) === 1;
      if (!legacyOn) continue;
      for (const key of RECEIVABLES_NAV_KEYS) {
        await pool.execute(
          `
          INSERT INTO role_permissions (role, permission_key, enabled)
          VALUES (?, ?, 1)
          ON DUPLICATE KEY UPDATE enabled = 1
          `,
          [role, key],
        );
      }
      // Keep legacy key off so child toggles control access independently.
      await pool.execute(
        `UPDATE role_permissions SET enabled = 0 WHERE role = ? AND permission_key = 'nav.reports.collection'`,
        [role],
      );
    }
  } catch (error) {
    console.warn("[role_permissions] Could not split receivables nav permissions:", error);
  }
}
