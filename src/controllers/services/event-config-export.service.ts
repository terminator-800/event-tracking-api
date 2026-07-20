import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../config/db";
import { getActiveAcademicPeriod } from "../../repositories/academic-periods.repository";
import { isDepartmentExcludedFromImport } from "../../models/departments.model";
import { newEventUuid } from "../../models/events.model";
import {
  hashEventPassword,
  MIN_EVENT_PASSWORD_LENGTH,
} from "./event-password.service";

export const EVENT_CONFIG_FORMAT = "NMCI-EVENT-CONFIG";
/** v2 adds event_uuid / master_event_uuid / event_version for CSG↔governor linking. */
export const EVENT_CONFIG_VERSION = 2;

export type EventConfigAudience = {
  department_code: string | null;
  department_name: string | null;
  course_code: string | null;
  course_name: string | null;
  major: string | null;
  year_level: number | null;
};

export type EventConfigPackage = {
  format: typeof EVENT_CONFIG_FORMAT;
  version: number;
  exported_at: string;
  exported_by: { username: string };
  academic_period: {
    school_year: string;
    semester: string;
  } | null;
  export_scope: {
    department_code: string | null;
    department_name: string | null;
  } | null;
  event: {
    event_uuid: string;
    master_event_uuid: string;
    event_version: number;
    name: string;
    date: string;
    venue: string;
    duration: string;
    event_mode: "TIME_IN_OUT" | "TIME_IN_ONLY";
    am_time_in: string | null;
    am_grace_in: number;
    am_time_out: string | null;
    am_grace_out: number;
    pm_time_in: string | null;
    pm_grace_in: number;
    pm_time_out: string | null;
    pm_grace_out: number;
    is_mandatory: boolean;
    is_all_departments: boolean;
    status: string;
    audience_notes: string | null;
    fine_amount: number;
    has_attendance_password: boolean;
  };
  audiences: EventConfigAudience[];
};

type EventRow = RowDataPacket & {
  id: number;
  event_uuid?: string | null;
  event_version?: number | null;
  master_event_uuid?: string | null;
  name: string;
  date: string | Date;
  venue: string;
  duration: string;
  event_mode?: string | null;
  am_time_in: string | Date | null;
  am_grace_in: number;
  am_time_out: string | Date | null;
  am_grace_out: number;
  pm_time_in: string | Date | null;
  pm_grace_in: number;
  pm_time_out: string | Date | null;
  pm_grace_out: number;
  is_mandatory: number | boolean;
  is_all_departments: number | boolean;
  status: string;
  audience_notes: string | null;
  fine_amount: number | string;
  attendance_password_hash: string | null;
  created_by: number;
  academic_period_id: number | null;
};

function formatSqlTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const h = String(value.getHours()).padStart(2, "0");
    const m = String(value.getMinutes()).padStart(2, "0");
    const s = String(value.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  // mysql2 sometimes returns "HH:MM:SS" or "HH:MM:SS.000000"
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

function formatSqlDate(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return String(value).slice(0, 10);
}

function safeFilenamePart(name: string): string {
  return String(name || "event")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60) || "event";
}

async function loadEvent(eventId: number): Promise<EventRow | null> {
  const [rows] = await pool.execute<EventRow[]>(
    `SELECT e.* FROM events e WHERE e.id = ? LIMIT 1`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function loadEventAudiences(eventId: number): Promise<EventConfigAudience[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       d.code AS department_code,
       d.name AS department_name,
       p.course_code,
       p.course_name,
       NULLIF(TRIM(p.major), '') AS major,
       ea.year_level
     FROM event_audiences ea
     LEFT JOIN departments d ON d.id = ea.department_id
     LEFT JOIN programs p ON p.id = ea.program_id
     WHERE ea.event_id = ?
     ORDER BY ea.id ASC`,
    [eventId],
  );

  return rows.map((r) => ({
    department_code: r.department_code != null ? String(r.department_code).trim() || null : null,
    department_name: r.department_name != null ? String(r.department_name).trim() || null : null,
    course_code: r.course_code != null ? String(r.course_code).trim() || null : null,
    course_name: r.course_name != null ? String(r.course_name).trim() || null : null,
    major: r.major != null ? String(r.major).trim() || null : null,
    year_level:
      r.year_level != null && Number.isFinite(Number(r.year_level))
        ? Number(r.year_level)
        : null,
  }));
}

async function loadAcademicPeriodLabel(
  academicPeriodId: number | null,
): Promise<EventConfigPackage["academic_period"]> {
  if (academicPeriodId == null) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT school_year, semester FROM academic_periods WHERE id = ? LIMIT 1`,
    [academicPeriodId],
  );
  if (!rows.length) return null;
  return {
    school_year: String(rows[0].school_year ?? "").trim(),
    semester: String(rows[0].semester ?? "").trim(),
  };
}

export async function assertCanAccessEventConfig(opts: {
  event: EventRow;
  userId: number;
  role: string;
  departmentId: number | null;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const role = String(opts.role ?? "").toLowerCase();
  if (role === "admin" || role === "super_admin") return { ok: true };

  if (role === "csg_president") {
    if (Number(opts.event.created_by) !== Number(opts.userId)) {
      return { ok: false, status: 403, message: "Access denied for this event." };
    }
    return { ok: true };
  }

  // Governors: must own the event and (all-dept or audience in their department)
  if (Number(opts.event.created_by) !== Number(opts.userId)) {
    return { ok: false, status: 403, message: "Access denied for this event." };
  }
  if (Number(opts.event.is_all_departments) === 1) return { ok: true };
  if (opts.departmentId == null) {
    return { ok: false, status: 403, message: "Access denied: no department assigned." };
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 AS ok FROM event_audiences
     WHERE event_id = ? AND department_id = ?
     LIMIT 1`,
    [opts.event.id, opts.departmentId],
  );
  if (!rows.length) {
    return { ok: false, status: 403, message: "Access denied for this event." };
  }
  return { ok: true };
}

export async function buildEventConfigPackage(opts: {
  eventId: number;
  username: string;
  departmentCodeFilter?: string | null;
}): Promise<{ pkg: EventConfigPackage; filename: string }> {
  const event = await loadEvent(opts.eventId);
  if (!event) throw Object.assign(new Error("Event not found."), { status: 404 });

  let audiences = await loadEventAudiences(opts.eventId);
  const filterCode = String(opts.departmentCodeFilter ?? "").trim().toUpperCase();
  let exportScope: EventConfigPackage["export_scope"] = null;
  let isAllDepartments = Number(event.is_all_departments) === 1;

  if (filterCode) {
    const matched = audiences.filter(
      (a) => String(a.department_code ?? "").trim().toUpperCase() === filterCode,
    );
    if (!isAllDepartments && matched.length === 0) {
      throw Object.assign(
        new Error(`No audience rows found for department code "${filterCode}".`),
        { status: 400 },
      );
    }
    const [deptRows] = await pool.execute<RowDataPacket[]>(
      `SELECT code, name FROM departments WHERE UPPER(TRIM(code)) = ? LIMIT 1`,
      [filterCode],
    );
    if (!deptRows.length) {
      throw Object.assign(new Error(`Department code "${filterCode}" not found.`), {
        status: 400,
      });
    }
    exportScope = {
      department_code: String(deptRows[0].code).trim(),
      department_name: String(deptRows[0].name).trim(),
    };
    // Slice all-dept events into a department-scoped config for transfer.
    if (isAllDepartments) {
      isAllDepartments = false;
      const yearLevels = [
        ...new Set(
          audiences
            .filter((a) => a.department_code == null && a.year_level != null)
            .map((a) => a.year_level as number),
        ),
      ];
      audiences =
        yearLevels.length > 0
          ? yearLevels.map((yl) => ({
              department_code: exportScope!.department_code,
              department_name: exportScope!.department_name,
              course_code: null,
              course_name: null,
              major: null,
              year_level: yl,
            }))
          : [
              {
                department_code: exportScope.department_code,
                department_name: exportScope.department_name,
                course_code: null,
                course_name: null,
                major: null,
                year_level: null,
              },
            ];
    } else {
      audiences = matched;
    }
  }

  const academicPeriod = await loadAcademicPeriodLabel(event.academic_period_id);
  const eventMode =
    String(event.event_mode ?? "").trim().toUpperCase() === "TIME_IN_ONLY"
      ? "TIME_IN_ONLY"
      : "TIME_IN_OUT";

  let eventUuid = String(event.event_uuid ?? "").trim();
  if (!eventUuid) {
    eventUuid = newEventUuid();
    await pool.execute(
      `UPDATE events
       SET event_uuid = ?, master_event_uuid = COALESCE(NULLIF(TRIM(master_event_uuid), ''), ?)
       WHERE id = ?`,
      [eventUuid, eventUuid, event.id],
    );
  }
  const masterUuid =
    String(event.master_event_uuid ?? "").trim() || eventUuid;
  const eventVersion = Math.max(1, Number(event.event_version) || 1);

  const pkg: EventConfigPackage = {
    format: EVENT_CONFIG_FORMAT,
    version: EVENT_CONFIG_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: { username: opts.username },
    academic_period: academicPeriod,
    export_scope: exportScope,
    event: {
      event_uuid: eventUuid,
      master_event_uuid: masterUuid,
      event_version: eventVersion,
      name: String(event.name ?? "").trim(),
      date: formatSqlDate(event.date),
      venue: String(event.venue ?? "").trim(),
      duration: String(event.duration ?? "Whole Day").trim(),
      event_mode: eventMode,
      am_time_in: formatSqlTime(event.am_time_in),
      am_grace_in: Math.max(0, Number(event.am_grace_in) || 0),
      am_time_out: formatSqlTime(event.am_time_out),
      am_grace_out: Math.max(0, Number(event.am_grace_out) || 0),
      pm_time_in: formatSqlTime(event.pm_time_in),
      pm_grace_in: Math.max(0, Number(event.pm_grace_in) || 0),
      pm_time_out: formatSqlTime(event.pm_time_out),
      pm_grace_out: Math.max(0, Number(event.pm_grace_out) || 0),
      is_mandatory: Boolean(Number(event.is_mandatory)),
      is_all_departments: isAllDepartments,
      status: "Upcoming",
      audience_notes:
        event.audience_notes != null && String(event.audience_notes).trim() !== ""
          ? String(event.audience_notes).trim()
          : null,
      fine_amount: Math.max(0, Number(event.fine_amount) || 0),
      has_attendance_password: Boolean(event.attendance_password_hash),
    },
    audiences,
  };

  const deptPart = exportScope?.department_code
    ? `_${exportScope.department_code}`
    : "";
  const filename = `${safeFilenamePart(pkg.event.name)}${deptPart}_${pkg.event.date}_config.json`;
  return { pkg, filename };
}

export function parseEventConfigBuffer(buffer: Buffer): EventConfigPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON file."), { status: 400 });
  }
  return validateEventConfigPackage(parsed);
}

export function validateEventConfigPackage(raw: unknown): EventConfigPackage {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("Invalid event config package."), { status: 400 });
  }
  const obj = raw as Record<string, unknown>;
  if (String(obj.format ?? "") !== EVENT_CONFIG_FORMAT) {
    throw Object.assign(
      new Error(`Unsupported format. Expected ${EVENT_CONFIG_FORMAT}.`),
      { status: 400 },
    );
  }
  const version = Number(obj.version);
  if (!Number.isFinite(version) || version < 1) {
    throw Object.assign(new Error("Unsupported or missing config version."), { status: 400 });
  }
  const eventRaw = obj.event;
  if (!eventRaw || typeof eventRaw !== "object") {
    throw Object.assign(new Error("Missing event configuration."), { status: 400 });
  }
  const e = eventRaw as Record<string, unknown>;
  const name = String(e.name ?? "").trim();
  const date = String(e.date ?? "").trim().slice(0, 10);
  const venue = String(e.venue ?? "").trim();
  const duration = String(e.duration ?? "").trim();
  const allowedDurations = new Set(["Whole Day", "Half Day", "AM Only", "PM Only"]);
  if (!name || !date || !venue || !allowedDurations.has(duration)) {
    throw Object.assign(
      new Error("Event name, date, venue, and a valid duration are required."),
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error("Event date must be YYYY-MM-DD."), { status: 400 });
  }

  const eventMode =
    String(e.event_mode ?? "").trim().toUpperCase() === "TIME_IN_ONLY"
      ? "TIME_IN_ONLY"
      : "TIME_IN_OUT";

  const eventUuid =
    String(e.event_uuid ?? "").trim() ||
    String((obj as { event_uuid?: string }).event_uuid ?? "").trim() ||
    "";
  const masterEventUuid =
    String(e.master_event_uuid ?? "").trim() || eventUuid || "";
  const eventVersion = Math.max(1, Number(e.event_version) || 1);

  const audiencesRaw = Array.isArray(obj.audiences) ? obj.audiences : [];
  const audiences: EventConfigAudience[] = audiencesRaw.map((row) => {
    const a = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const yl = a.year_level;
    return {
      department_code:
        a.department_code != null && String(a.department_code).trim() !== ""
          ? String(a.department_code).trim()
          : null,
      department_name:
        a.department_name != null && String(a.department_name).trim() !== ""
          ? String(a.department_name).trim()
          : null,
      course_code:
        a.course_code != null && String(a.course_code).trim() !== ""
          ? String(a.course_code).trim()
          : null,
      course_name:
        a.course_name != null && String(a.course_name).trim() !== ""
          ? String(a.course_name).trim()
          : null,
      major:
        a.major != null && String(a.major).trim() !== "" ? String(a.major).trim() : null,
      year_level: yl != null && Number.isFinite(Number(yl)) ? Number(yl) : null,
    };
  });

  const academic =
    obj.academic_period && typeof obj.academic_period === "object"
      ? (obj.academic_period as Record<string, unknown>)
      : null;

  const scope =
    obj.export_scope && typeof obj.export_scope === "object"
      ? (obj.export_scope as Record<string, unknown>)
      : null;

  return {
    format: EVENT_CONFIG_FORMAT,
    version,
    exported_at: String(obj.exported_at ?? ""),
    exported_by: {
      username:
        obj.exported_by && typeof obj.exported_by === "object"
          ? String((obj.exported_by as Record<string, unknown>).username ?? "")
          : "",
    },
    academic_period: academic
      ? {
          school_year: String(academic.school_year ?? "").trim(),
          semester: String(academic.semester ?? "").trim(),
        }
      : null,
    export_scope: scope
      ? {
          department_code:
            scope.department_code != null && String(scope.department_code).trim() !== ""
              ? String(scope.department_code).trim()
              : null,
          department_name:
            scope.department_name != null && String(scope.department_name).trim() !== ""
              ? String(scope.department_name).trim()
              : null,
        }
      : null,
    event: {
      event_uuid: eventUuid,
      master_event_uuid: masterEventUuid || eventUuid,
      event_version: eventVersion,
      name,
      date,
      venue,
      duration,
      event_mode: eventMode,
      am_time_in: formatSqlTime((e.am_time_in as string | null) ?? null),
      am_grace_in: Math.max(0, Number(e.am_grace_in) || 0),
      am_time_out: formatSqlTime((e.am_time_out as string | null) ?? null),
      am_grace_out: Math.max(0, Number(e.am_grace_out) || 0),
      pm_time_in: formatSqlTime((e.pm_time_in as string | null) ?? null),
      pm_grace_in: Math.max(0, Number(e.pm_grace_in) || 0),
      pm_time_out: formatSqlTime((e.pm_time_out as string | null) ?? null),
      pm_grace_out: Math.max(0, Number(e.pm_grace_out) || 0),
      is_mandatory: Boolean(e.is_mandatory),
      is_all_departments: Boolean(e.is_all_departments),
      status: "Upcoming",
      audience_notes:
        e.audience_notes != null && String(e.audience_notes).trim() !== ""
          ? String(e.audience_notes).trim()
          : null,
      fine_amount: Math.max(0, Number(e.fine_amount) || 0),
      has_attendance_password: Boolean(e.has_attendance_password),
    },
    audiences,
  };
}

type ResolvedAudience = {
  departmentId: number | null;
  programId: number | null;
  yearLevel: number | null;
};

async function resolveDepartmentId(code: string | null): Promise<number | null> {
  if (!code) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM departments WHERE UPPER(TRIM(code)) = UPPER(TRIM(?)) LIMIT 1`,
    [code],
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function resolveProgramId(
  departmentId: number,
  courseCode: string | null,
  major: string | null,
): Promise<number | null> {
  if (!courseCode) return null;
  if (major) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM programs
       WHERE department_id = ?
         AND UPPER(TRIM(course_code)) = UPPER(TRIM(?))
         AND LOWER(TRIM(COALESCE(major, ''))) = LOWER(TRIM(?))
       LIMIT 1`,
      [departmentId, courseCode, major],
    );
    if (rows.length) return Number(rows[0].id);
  }
  const [anyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM programs
     WHERE department_id = ?
       AND UPPER(TRIM(course_code)) = UPPER(TRIM(?))
     ORDER BY id ASC
     LIMIT 1`,
    [departmentId, courseCode],
  );
  return anyRows.length ? Number(anyRows[0].id) : null;
}

export type EventConfigPreviewResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
  package: EventConfigPackage;
  duplicate: { id: number; name: string; date: string; status: string } | null;
  unresolved_audiences: EventConfigAudience[];
  academic_period_match: "exact" | "active_fallback" | "missing_active";
};

export async function previewEventConfigImport(
  pkg: EventConfigPackage,
  opts: { role: string; departmentId: number | null; userId?: number | null },
): Promise<EventConfigPreviewResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const role = String(opts.role ?? "").toLowerCase();

  if (
    pkg.event.is_all_departments &&
    role !== "admin" &&
    role !== "super_admin" &&
    role !== "csg_president"
  ) {
    errors.push("Only CSG/Admin can import all-departments events.");
  }

  const active = await getActiveAcademicPeriod();
  let academic_period_match: EventConfigPreviewResult["academic_period_match"] =
    "missing_active";
  if (!active) {
    errors.push("No active school year and semester. Activate an academic period first.");
  } else {
    academic_period_match = "active_fallback";
    if (pkg.academic_period?.school_year && pkg.academic_period?.semester) {
      const sy = pkg.academic_period.school_year.toLowerCase();
      const sem = pkg.academic_period.semester.toLowerCase();
      if (
        String(active.school_year).toLowerCase() === sy &&
        String(active.semester).toLowerCase() === sem
      ) {
        academic_period_match = "exact";
      } else {
        warnings.push(
          `Config period (${pkg.academic_period.school_year} / ${pkg.academic_period.semester}) differs from active period (${active.school_year} / ${active.semester}). Import will use the active period.`,
        );
      }
    }
  }

  const unresolved: EventConfigAudience[] = [];
  if (!pkg.event.is_all_departments) {
    if (pkg.audiences.length === 0) {
      errors.push("Department-scoped event has no audience rows.");
    }
    for (const a of pkg.audiences) {
      if (!a.department_code) {
        unresolved.push(a);
        continue;
      }
      const deptId = await resolveDepartmentId(a.department_code);
      if (deptId == null) {
        unresolved.push(a);
        continue;
      }
      if (
        opts.departmentId != null &&
        role !== "admin" &&
        role !== "super_admin" &&
        role !== "csg_president" &&
        Number(deptId) !== Number(opts.departmentId)
      ) {
        errors.push(
          `Audience department ${a.department_code} is outside your department scope.`,
        );
      }
      if (a.course_code) {
        const programId = await resolveProgramId(deptId, a.course_code, a.major);
        if (programId == null) {
          unresolved.push(a);
        }
      }
    }
  }

  if (unresolved.length) {
    errors.push(
      `${unresolved.length} audience row(s) could not be resolved to local departments/programs.`,
    );
  }

  let duplicate: EventConfigPreviewResult["duplicate"] = null;
  if (active) {
    const masterKey =
      String(pkg.event.master_event_uuid || pkg.event.event_uuid || "").trim();
    const isInstitutionRole =
      role === "admin" || role === "super_admin" || role === "csg_president";
    const userId = opts.userId != null ? Number(opts.userId) : null;

    // Governors: only match their own linked/local copy — never the CSG master.
    // CSG/admin: match the master event_uuid (or their own row).
    if (masterKey) {
      let uuidRows: RowDataPacket[] = [];
      if (isInstitutionRole) {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT id, name, DATE_FORMAT(date, '%Y-%m-%d') AS date, status
           FROM events
           WHERE academic_period_id = ?
             AND (
               event_uuid = ?
               OR (master_event_uuid = ? AND (? IS NULL OR created_by = ?))
             )
           ORDER BY CASE WHEN event_uuid = ? THEN 0 ELSE 1 END, id ASC
           LIMIT 1`,
          [active.id, masterKey, masterKey, userId, userId, masterKey],
        );
        uuidRows = rows;
      } else if (userId != null) {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `SELECT id, name, DATE_FORMAT(date, '%Y-%m-%d') AS date, status
           FROM events
           WHERE academic_period_id = ?
             AND created_by = ?
             AND (
               event_uuid = ?
               OR master_event_uuid = ?
             )
           ORDER BY id ASC
           LIMIT 1`,
          [active.id, userId, masterKey, masterKey],
        );
        uuidRows = rows;
      }

      if (uuidRows.length) {
        duplicate = {
          id: Number(uuidRows[0].id),
          name: String(uuidRows[0].name),
          date: String(uuidRows[0].date),
          status: String(uuidRows[0].status),
        };
        warnings.push(
          `Event UUID match found ("${duplicate.name}"). Choose Update Existing Event or Cancel.`,
        );
      }
    }

    if (!duplicate) {
      const nameParams: (string | number)[] = [
        active.id,
        pkg.event.name,
        pkg.event.date,
        pkg.event.duration,
      ];
      let nameSql = `SELECT id, name, DATE_FORMAT(date, '%Y-%m-%d') AS date, status, duration
         FROM events
         WHERE academic_period_id = ?
           AND LOWER(TRIM(name)) = LOWER(TRIM(?))
           AND DATE(date) = ?
           AND LOWER(TRIM(duration)) = LOWER(TRIM(?))`;
      if (!isInstitutionRole && userId != null) {
        nameSql += ` AND created_by = ?`;
        nameParams.push(userId);
      } else if (isInstitutionRole && userId != null && role === "csg_president") {
        nameSql += ` AND created_by = ?`;
        nameParams.push(userId);
      }
      nameSql += ` LIMIT 1`;

      const [dupRows] = await pool.execute<RowDataPacket[]>(nameSql, nameParams);
      if (dupRows.length) {
        duplicate = {
          id: Number(dupRows[0].id),
          name: String(dupRows[0].name),
          date: String(dupRows[0].date),
          status: String(dupRows[0].status),
        };
        warnings.push(
          `Matching event found ("${duplicate.name}" on ${duplicate.date}, ${pkg.event.duration}). Import will update/merge into that event.`,
        );
      }
    }
  }

  if (pkg.event.has_attendance_password) {
    warnings.push(
      "Source event used an attendance password. Provide a new password on import (hashes are never transferred).",
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    package: pkg,
    duplicate,
    unresolved_audiences: unresolved,
    academic_period_match,
  };
}

export type ImportEventConfigAction = "check" | "create" | "merge" | "update" | "cancel";

export type ImportEventConfigResult = {
  success: boolean;
  message: string;
  eventId?: number;
  action?: ImportEventConfigAction;
  audiences_added?: number;
  preview?: EventConfigPreviewResult;
};

async function resolveAudiencesForInsert(
  pkg: EventConfigPackage,
): Promise<ResolvedAudience[]> {
  if (pkg.event.is_all_departments) {
    const years = [
      ...new Set(
        pkg.audiences
          .filter((a) => a.year_level != null)
          .map((a) => a.year_level as number),
      ),
    ];
    if (years.length === 0) return [];
    return years.map((yearLevel) => ({
      departmentId: null,
      programId: null,
      yearLevel,
    }));
  }

  const resolved: ResolvedAudience[] = [];
  for (const a of pkg.audiences) {
    const departmentId = await resolveDepartmentId(a.department_code);
    if (departmentId == null) {
      throw Object.assign(
        new Error(`Department not found: ${a.department_code ?? "(missing code)"}`),
        { status: 400 },
      );
    }
    let programId: number | null = null;
    if (a.course_code) {
      programId = await resolveProgramId(departmentId, a.course_code, a.major);
      if (programId == null) {
        throw Object.assign(
          new Error(
            `Program not found: ${a.course_code}${a.major ? ` / ${a.major}` : ""}`,
          ),
          { status: 400 },
        );
      }
    }
    resolved.push({
      departmentId,
      programId,
      yearLevel: a.year_level,
    });
  }
  return resolved;
}

async function audienceRowExists(
  connection: { execute: typeof pool.execute },
  eventId: number,
  row: ResolvedAudience,
): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM event_audiences
     WHERE event_id = ?
       AND department_id <=> ?
       AND program_id <=> ?
       AND year_level <=> ?
     LIMIT 1`,
    [eventId, row.departmentId, row.programId, row.yearLevel],
  );
  return rows.length > 0;
}

/**
 * Merge imported department/program/year audiences into an existing event.
 * Does not create a new event and does not import student records.
 */
async function mergeAudiencesIntoEvent(opts: {
  eventId: number;
  pkg: EventConfigPackage;
}): Promise<{ audiencesAdded: number; becameAllDepartments: boolean }> {
  const [eventRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, is_all_departments, status FROM events WHERE id = ? LIMIT 1`,
    [opts.eventId],
  );
  if (!eventRows.length) {
    throw Object.assign(new Error("Existing event not found."), { status: 404 });
  }

  const existing = eventRows[0];
  const existingIsAll = Number(existing.is_all_departments) === 1;
  let audiencesAdded = 0;
  let becameAllDepartments = false;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Importing an all-departments config expands the existing event to all departments.
    if (opts.pkg.event.is_all_departments && !existingIsAll) {
      await connection.execute(`UPDATE events SET is_all_departments = 1 WHERE id = ?`, [
        opts.eventId,
      ]);
      // Keep year-only audience rows from the import if present; drop dept-scoped rows
      // so eligibility uses the all-departments path.
      await connection.execute(`DELETE FROM event_audiences WHERE event_id = ?`, [opts.eventId]);
      const yearAudiences = await resolveAudiencesForInsert(opts.pkg);
      for (const row of yearAudiences) {
        await connection.execute(
          `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
           VALUES (?, ?, ?, ?)`,
          [opts.eventId, row.departmentId, row.programId, row.yearLevel],
        );
        audiencesAdded += 1;
      }
      becameAllDepartments = true;
      await connection.commit();
      return { audiencesAdded, becameAllDepartments };
    }

    // Existing event already covers all departments — nothing department-scoped to add.
    if (existingIsAll) {
      await connection.commit();
      return { audiencesAdded: 0, becameAllDepartments: false };
    }

    const incoming = await resolveAudiencesForInsert(opts.pkg);
    for (const row of incoming) {
      if (await audienceRowExists(connection, opts.eventId, row)) continue;
      await connection.execute(
        `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
         VALUES (?, ?, ?, ?)`,
        [opts.eventId, row.departmentId, row.programId, row.yearLevel],
      );
      audiencesAdded += 1;
    }

    await connection.commit();
    return { audiencesAdded, becameAllDepartments };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function importEventConfig(opts: {
  pkg: EventConfigPackage;
  userId: number;
  username: string;
  role: string;
  departmentId: number | null;
  attendancePassword: string;
  action?: ImportEventConfigAction;
}): Promise<ImportEventConfigResult> {
  const requestedAction: ImportEventConfigAction = opts.action ?? "check";
  const preview = await previewEventConfigImport(opts.pkg, {
    role: opts.role,
    departmentId: opts.departmentId,
    userId: opts.userId,
  });

  if (!preview.valid) {
    return {
      success: false,
      message: preview.errors[0] ?? "Import preview failed.",
      preview,
    };
  }

  // Existing event (UUID or name/date/session) → update/merge, never create a copy.
  if (preview.duplicate) {
    if (requestedAction === "cancel" || requestedAction === "check") {
      return {
        success: requestedAction === "cancel",
        message:
          requestedAction === "cancel"
            ? "Import cancelled — existing event was left unchanged."
            : "Event UUID already exists. Choose Update Existing Event or Cancel.",
        eventId: preview.duplicate.id,
        action: requestedAction === "cancel" ? "cancel" : "check",
        preview,
      };
    }

    // update | merge | create (legacy) → refresh audiences into existing event
    const { audiencesAdded, becameAllDepartments } = await mergeAudiencesIntoEvent({
      eventId: preview.duplicate.id,
      pkg: opts.pkg,
    });

    // Keep master_event_uuid linkage and bump version on update.
    const masterKey =
      String(opts.pkg.event.master_event_uuid || opts.pkg.event.event_uuid || "").trim() ||
      null;
    if (masterKey) {
      await pool.execute(
        `UPDATE events
         SET master_event_uuid = COALESCE(NULLIF(TRIM(master_event_uuid), ''), ?),
             event_version = GREATEST(event_version, ?)
         WHERE id = ?`,
        [masterKey, Math.max(1, Number(opts.pkg.event.event_version) || 1), preview.duplicate.id],
      );
    }

    let message =
      audiencesAdded > 0
        ? `Updated existing event "${preview.duplicate.name}". Added ${audiencesAdded} department/audience assignment(s).`
        : `Updated existing event "${preview.duplicate.name}". Department assignments were already present.`;
    if (becameAllDepartments) {
      message = `Updated existing event "${preview.duplicate.name}" and expanded it to all departments.`;
    }

    return {
      success: true,
      message,
      eventId: preview.duplicate.id,
      action: "update",
      audiences_added: audiencesAdded,
      preview,
    };
  }

  // New event — password required.
  const password = String(opts.attendancePassword ?? "").trim();
  if (password.length < MIN_EVENT_PASSWORD_LENGTH) {
    return {
      success: false,
      message: `Event password is required and must be at least ${MIN_EVENT_PASSWORD_LENGTH} characters.`,
      preview,
    };
  }

  const active = await getActiveAcademicPeriod();
  if (!active) {
    return {
      success: false,
      message: "No active academic period.",
      preview,
    };
  }

  const audiences = await resolveAudiencesForInsert(opts.pkg);
  const passwordHash = await hashEventPassword(password);
  const ev = opts.pkg.event;
  const localUuid = newEventUuid();
  const masterUuid =
    String(ev.master_event_uuid || ev.event_uuid || "").trim() || localUuid;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO events (
        event_uuid, event_version, master_event_uuid,
        name, date, venue, duration, event_mode,
        am_time_in, am_grace_in, am_time_out, am_grace_out,
        pm_time_in, pm_grace_in, pm_time_out, pm_grace_out,
        is_mandatory, is_all_departments,
        status, audience_notes, fine_amount, attendance_password_hash,
        created_by, academic_period_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localUuid,
        Math.max(1, Number(ev.event_version) || 1),
        masterUuid,
        ev.name,
        ev.date,
        ev.venue,
        ev.duration,
        ev.event_mode,
        ev.am_time_in,
        ev.am_grace_in,
        ev.am_time_out,
        ev.am_grace_out,
        ev.pm_time_in,
        ev.pm_grace_in,
        ev.pm_time_out,
        ev.pm_grace_out,
        ev.is_mandatory ? 1 : 0,
        ev.is_all_departments ? 1 : 0,
        "Upcoming",
        ev.audience_notes,
        ev.fine_amount,
        passwordHash,
        opts.userId,
        active.id,
      ],
    );
    const eventId = result.insertId;

    for (const row of audiences) {
      await connection.execute(
        `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
         VALUES (?, ?, ?, ?)`,
        [eventId, row.departmentId, row.programId, row.yearLevel],
      );
    }

    if (!ev.is_all_departments && audiences.length === 0) {
      throw Object.assign(new Error("No audiences to attach to imported event."), {
        status: 400,
      });
    }

    await connection.commit();
    return {
      success: true,
      message: masterUuid !== localUuid
        ? "Department event created and linked to the master Event UUID."
        : "Event configuration imported successfully.",
      eventId,
      action: "create",
      audiences_added: audiences.length,
      preview,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function getEventRowForAccess(eventId: number): Promise<EventRow | null> {
  return loadEvent(eventId);
}

export type EventConfigRosterDepartment = {
  id: number;
  code: string;
  name: string;
};

export type EventConfigRosterResult = {
  event_id: number;
  is_all_departments: boolean;
  departments: EventConfigRosterDepartment[];
  selected_department_code: string | null;
};

async function listAllDepartmentsForExport(): Promise<EventConfigRosterDepartment[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, code FROM departments ORDER BY name ASC`,
  );
  return rows
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? "").trim(),
      code: String(row.code ?? "").trim().toUpperCase(),
    }))
    .filter((row) => row.name && row.code && !isDepartmentExcludedFromImport(row.name));
}

/**
 * Departments available for export scope only.
 * Student records are never part of event-config transfer — participants resolve
 * from the importing system's existing student database via audience departments.
 */
export async function getEventConfigRoster(opts: {
  eventId: number;
  departmentCode?: string | null;
  role: string;
  userDepartmentId: number | null;
}): Promise<EventConfigRosterResult> {
  const event = await loadEvent(opts.eventId);
  if (!event) {
    throw Object.assign(new Error("Event not found."), { status: 404 });
  }

  const isAll = Number(event.is_all_departments) === 1;
  const role = String(opts.role ?? "").toLowerCase();
  const allDepts = await listAllDepartmentsForExport();

  let departments: EventConfigRosterDepartment[] = allDepts;

  if (!isAll) {
    const audiences = await loadEventAudiences(opts.eventId);
    const codes = new Set(
      audiences
        .map((a) => String(a.department_code ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    if (codes.size > 0) {
      departments = allDepts.filter((d) => codes.has(d.code));
    }
  }

  if (
    role !== "admin" &&
    role !== "super_admin" &&
    role !== "csg_president" &&
    opts.userDepartmentId != null
  ) {
    departments = allDepts.filter((d) => Number(d.id) === Number(opts.userDepartmentId));
  }

  const selectedCode = String(opts.departmentCode ?? "").trim().toUpperCase() || null;

  if (selectedCode) {
    const match =
      allDepts.find((d) => d.code === selectedCode) ??
      departments.find((d) => d.code === selectedCode);
    if (!match) {
      throw Object.assign(new Error(`Department code "${selectedCode}" not found.`), {
        status: 400,
      });
    }
    if (
      role !== "admin" &&
      role !== "super_admin" &&
      role !== "csg_president" &&
      opts.userDepartmentId != null &&
      Number(match.id) !== Number(opts.userDepartmentId)
    ) {
      throw Object.assign(new Error("Access denied for that department."), { status: 403 });
    }
  }

  return {
    event_id: opts.eventId,
    is_all_departments: isAll,
    departments,
    selected_department_code: selectedCode,
  };
}
