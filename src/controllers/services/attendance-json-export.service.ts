import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../config/db";
import { newEventUuid } from "../../models/events.model";
import {
  selectStudentsForEventDetail,
  type EventStudentRow,
} from "../../repositories/attendance-page.repository";
import { getActiveAcademicPeriod } from "../../repositories/academic-periods.repository";

export const ATTENDANCE_JSON_FORMAT = "NMCI-ATTENDANCE";
export const ATTENDANCE_JSON_VERSION = 1;

export type AttendanceJsonRecord = {
  student_id: string;
  rfid: string | null;
  time_in: string | null;
  time_out: string | null;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  status: "Present" | "Absent";
  fine: number;
};

export type AttendanceJsonPackage = {
  format: typeof ATTENDANCE_JSON_FORMAT;
  version: number;
  exported_at: string;
  exported_by: { username: string };
  event_uuid: string;
  department: {
    code: string;
    name: string | null;
  };
  summary: {
    total: number;
    present: number;
    absent: number;
  };
  attendance: AttendanceJsonRecord[];
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
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

function parseTimeValue(raw: unknown): string | null {
  return formatSqlTime((raw as string | null) ?? null);
}

function safeFilenamePart(name: string): string {
  return String(name || "event")
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "event";
}

function primaryTimes(
  duration: string,
  amIn: string | null,
  amOut: string | null,
  pmIn: string | null,
  pmOut: string | null,
): { time_in: string | null; time_out: string | null } {
  const d = String(duration ?? "").toLowerCase();
  if (d.includes("pm")) {
    return { time_in: pmIn, time_out: pmOut };
  }
  if (d.includes("am") && !d.includes("whole")) {
    return { time_in: amIn, time_out: amOut };
  }
  // Whole Day / Half Day: earliest in, latest out
  const timeIn = amIn || pmIn;
  const timeOut = pmOut || amOut;
  return { time_in: timeIn, time_out: timeOut };
}

async function ensureEventUuid(eventId: number): Promise<{
  event_uuid: string;
  master_event_uuid: string;
  name: string;
  duration: string;
  academic_period_id: number | null;
}> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, event_uuid, master_event_uuid, name, duration, academic_period_id
     FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!rows.length) {
    throw Object.assign(new Error("Event not found."), { status: 404 });
  }
  const row = rows[0];
  let eventUuid = String(row.event_uuid ?? "").trim();
  let masterUuid = String(row.master_event_uuid ?? "").trim();
  if (!eventUuid) {
    eventUuid = newEventUuid();
    masterUuid = masterUuid || eventUuid;
    await pool.execute(
      `UPDATE events
       SET event_uuid = ?, master_event_uuid = COALESCE(NULLIF(TRIM(master_event_uuid), ''), ?)
       WHERE id = ?`,
      [eventUuid, masterUuid, eventId],
    );
  }
  if (!masterUuid) masterUuid = eventUuid;
  return {
    event_uuid: eventUuid,
    master_event_uuid: masterUuid,
    name: String(row.name ?? "event"),
    duration: String(row.duration ?? "Whole Day"),
    academic_period_id: row.academic_period_id != null ? Number(row.academic_period_id) : null,
  };
}

async function resolveDepartmentLabel(opts: {
  departmentId: number | null;
  departmentCode?: string | null;
}): Promise<{ id: number | null; code: string; name: string | null }> {
  if (opts.departmentId != null) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, code, name FROM departments WHERE id = ? LIMIT 1`,
      [opts.departmentId],
    );
    if (rows.length) {
      return {
        id: Number(rows[0].id),
        code: String(rows[0].code ?? "").trim().toUpperCase(),
        name: String(rows[0].name ?? "").trim() || null,
      };
    }
  }
  const code = String(opts.departmentCode ?? "").trim().toUpperCase();
  if (code) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, code, name FROM departments WHERE UPPER(TRIM(code)) = ? LIMIT 1`,
      [code],
    );
    if (rows.length) {
      return {
        id: Number(rows[0].id),
        code: String(rows[0].code ?? "").trim().toUpperCase(),
        name: String(rows[0].name ?? "").trim() || null,
      };
    }
    return { id: null, code, name: null };
  }
  throw Object.assign(new Error("Department is required for attendance export."), {
    status: 400,
  });
}

/**
 * Export attendance only (no event configuration).
 * event_uuid in the package is the master Event UUID for CSG merge.
 */
export async function buildAttendanceJsonPackage(opts: {
  eventId: number;
  username: string;
  departmentId: number | null;
  departmentCode?: string | null;
}): Promise<{ pkg: AttendanceJsonPackage; filename: string }> {
  const eventMeta = await ensureEventUuid(opts.eventId);
  const dept = await resolveDepartmentLabel({
    departmentId: opts.departmentId,
    departmentCode: opts.departmentCode,
  });

  const students = await selectStudentsForEventDetail(opts.eventId, dept.id);
  const attendance: AttendanceJsonRecord[] = students.map((s: EventStudentRow) => {
    const amIn = formatSqlTime(s.am_time_in);
    const amOut = formatSqlTime(s.am_time_out);
    const pmIn = formatSqlTime(s.pm_time_in);
    const pmOut = formatSqlTime(s.pm_time_out);
    const present = Boolean(amIn || amOut || pmIn || pmOut);
    const primary = primaryTimes(eventMeta.duration, amIn, amOut, pmIn, pmOut);
    return {
      student_id: String(s.student_id ?? "").trim(),
      rfid: s.rfid != null && String(s.rfid).trim() ? String(s.rfid).trim() : null,
      time_in: primary.time_in,
      time_out: primary.time_out,
      am_time_in: amIn,
      am_time_out: amOut,
      pm_time_in: pmIn,
      pm_time_out: pmOut,
      status: present ? "Present" : "Absent",
      fine: Math.max(0, Number(s.fine_total) || 0),
    };
  });

  const present = attendance.filter((r) => r.status === "Present").length;
  const pkg: AttendanceJsonPackage = {
    format: ATTENDANCE_JSON_FORMAT,
    version: ATTENDANCE_JSON_VERSION,
    exported_at: new Date().toISOString(),
    exported_by: { username: opts.username },
    // Always export the master UUID so CSG can locate the campus-wide event.
    event_uuid: eventMeta.master_event_uuid,
    department: { code: dept.code, name: dept.name },
    summary: {
      total: attendance.length,
      present,
      absent: attendance.length - present,
    },
    attendance,
  };

  const filename = `${safeFilenamePart(eventMeta.name)}_${dept.code}_attendance.json`;
  return { pkg, filename };
}

export function validateAttendanceJsonPackage(raw: unknown): AttendanceJsonPackage {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("Invalid attendance package."), { status: 400 });
  }
  const obj = raw as Record<string, unknown>;
  if (String(obj.format ?? "") !== ATTENDANCE_JSON_FORMAT) {
    throw Object.assign(
      new Error(`Unsupported format. Expected ${ATTENDANCE_JSON_FORMAT}.`),
      { status: 400 },
    );
  }
  const eventUuid = String(obj.event_uuid ?? "").trim();
  if (!eventUuid) {
    throw Object.assign(new Error("event_uuid is required."), { status: 400 });
  }
  const deptRaw = (obj.department ?? {}) as Record<string, unknown>;
  const deptCode = String(deptRaw.code ?? obj.department_code ?? "").trim().toUpperCase();
  if (!deptCode) {
    throw Object.assign(new Error("department.code is required."), { status: 400 });
  }

  const rows = Array.isArray(obj.attendance)
    ? obj.attendance
    : Array.isArray(obj.records)
      ? obj.records
      : [];

  const attendance: AttendanceJsonRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const studentId = String(r.student_id ?? "").trim();
    if (!studentId) continue;
    const amIn = parseTimeValue(r.am_time_in);
    const amOut = parseTimeValue(r.am_time_out);
    const pmIn = parseTimeValue(r.pm_time_in);
    const pmOut = parseTimeValue(r.pm_time_out);
    let timeIn = parseTimeValue(r.time_in);
    let timeOut = parseTimeValue(r.time_out);
    // Map simple time_in/out into AM when session fields are absent.
    if (!amIn && !pmIn && timeIn) {
      // Keep as AM by default; import maps by event duration.
    }
    const present =
      String(r.status ?? "").toLowerCase() === "present" ||
      Boolean(amIn || amOut || pmIn || pmOut || timeIn || timeOut);
    attendance.push({
      student_id: studentId,
      rfid: r.rfid != null && String(r.rfid).trim() ? String(r.rfid).trim() : null,
      time_in: timeIn,
      time_out: timeOut,
      am_time_in: amIn,
      am_time_out: amOut,
      pm_time_in: pmIn,
      pm_time_out: pmOut,
      status: present ? "Present" : "Absent",
      fine: Math.max(0, Number(r.fine) || 0),
    });
  }

  return {
    format: ATTENDANCE_JSON_FORMAT,
    version: Math.max(1, Number(obj.version) || 1),
    exported_at: String(obj.exported_at ?? new Date().toISOString()),
    exported_by: {
      username: String((obj.exported_by as { username?: string } | undefined)?.username ?? ""),
    },
    event_uuid: eventUuid,
    department: {
      code: deptCode,
      name: deptRaw.name != null ? String(deptRaw.name).trim() || null : null,
    },
    summary: {
      total: attendance.length,
      present: attendance.filter((a) => a.status === "Present").length,
      absent: attendance.filter((a) => a.status === "Absent").length,
    },
    attendance,
  };
}

export function parseAttendanceJsonBuffer(buffer: Buffer): AttendanceJsonPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw Object.assign(new Error("File is not valid JSON."), { status: 400 });
  }
  return validateAttendanceJsonPackage(parsed);
}

export type AttendanceImportAction = "skip" | "update";

export type AttendanceImportPreview = {
  valid: boolean;
  warnings: string[];
  errors: string[];
  package: AttendanceJsonPackage;
  master_event: {
    id: number;
    name: string;
    date: string;
    status: string;
    event_uuid: string;
  } | null;
};

export type AttendanceImportResult = {
  success: boolean;
  message: string;
  eventId?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  unmatched?: number;
  preview?: AttendanceImportPreview;
};

async function findMasterEventByUuid(eventUuid: string): Promise<{
  id: number;
  name: string;
  date: string;
  status: string;
  event_uuid: string;
  duration: string;
  academic_period_id: number | null;
} | null> {
  const key = String(eventUuid ?? "").trim();
  if (!key) return null;

  // Prefer the true master (event_uuid = key), then any child linked by master_event_uuid.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, DATE_FORMAT(date, '%Y-%m-%d') AS date, status,
            event_uuid, master_event_uuid, duration, academic_period_id
     FROM events
     WHERE event_uuid = ? OR master_event_uuid = ?
     ORDER BY CASE WHEN event_uuid = ? THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [key, key, key],
  );
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    name: String(rows[0].name),
    date: String(rows[0].date),
    status: String(rows[0].status),
    event_uuid: String(rows[0].event_uuid ?? key),
    duration: String(rows[0].duration ?? "Whole Day"),
    academic_period_id:
      rows[0].academic_period_id != null ? Number(rows[0].academic_period_id) : null,
  };
}

export async function previewAttendanceJsonImport(
  pkg: AttendanceJsonPackage,
): Promise<AttendanceImportPreview> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const master = await findMasterEventByUuid(pkg.event_uuid);
  if (!master) {
    errors.push(
      `No master event found for Event UUID ${pkg.event_uuid}. Import the event config first, or verify the UUID.`,
    );
  } else {
    warnings.push(
      `Will merge ${pkg.department.code} attendance into "${master.name}" (${master.date}).`,
    );
  }
  if (pkg.attendance.length === 0) {
    warnings.push("Attendance file contains no student records.");
  }
  return {
    valid: errors.length === 0,
    warnings,
    errors,
    package: pkg,
    master_event: master
      ? {
          id: master.id,
          name: master.name,
          date: master.date,
          status: master.status,
          event_uuid: master.event_uuid,
        }
      : null,
  };
}

async function resolveStudentPk(record: AttendanceJsonRecord): Promise<number | null> {
  const sid = String(record.student_id ?? "").trim();
  if (sid) {
    const [byId] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
      [sid],
    );
    if (byId.length) return Number(byId[0].id);
  }
  const rfid = String(record.rfid ?? "").trim();
  if (rfid) {
    const [byRfid] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM students WHERE rfid = ? LIMIT 1`,
      [rfid],
    );
    if (byRfid.length) return Number(byRfid[0].id);
  }
  return null;
}

function mapTimesForDuration(
  duration: string,
  record: AttendanceJsonRecord,
): {
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
} {
  let amIn = record.am_time_in;
  let amOut = record.am_time_out;
  let pmIn = record.pm_time_in;
  let pmOut = record.pm_time_out;

  if (!amIn && !amOut && !pmIn && !pmOut) {
    const d = String(duration ?? "").toLowerCase();
    if (d.includes("pm")) {
      pmIn = record.time_in;
      pmOut = record.time_out;
    } else {
      amIn = record.time_in;
      amOut = record.time_out;
    }
  }

  return {
    am_time_in: amIn,
    am_time_out: amOut,
    pm_time_in: pmIn,
    pm_time_out: pmOut,
  };
}

/**
 * Merge department attendance into the master event identified by Event UUID.
 * Match: Student ID preferred, RFID fallback.
 * Existing attendance: skip (default) or update when action = "update".
 */
export async function importAttendanceJson(opts: {
  pkg: AttendanceJsonPackage;
  action?: AttendanceImportAction;
  userId?: number;
  role?: string;
}): Promise<AttendanceImportResult> {
  const action: AttendanceImportAction = opts.action === "update" ? "update" : "skip";
  const preview = await previewAttendanceJsonImport(opts.pkg);
  if (!preview.valid || !preview.master_event) {
    return {
      success: false,
      message: preview.errors[0] || "Cannot import attendance.",
      preview,
    };
  }

  const master = await findMasterEventByUuid(opts.pkg.event_uuid);
  if (!master) {
    return {
      success: false,
      message: "Master event not found.",
      preview,
    };
  }

  const role = String(opts.role ?? "").toLowerCase();
  if (role === "csg_president" && opts.userId != null) {
    const [own] = await pool.execute<RowDataPacket[]>(
      `SELECT created_by FROM events WHERE id = ? LIMIT 1`,
      [master.id],
    );
    if (!own.length || Number(own[0].created_by) !== Number(opts.userId)) {
      return {
        success: false,
        message: "You can only import attendance into master events you created.",
        preview,
      };
    }
  }

  const active = await getActiveAcademicPeriod();
  const academicPeriodId = master.academic_period_id ?? active?.id ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const record of opts.pkg.attendance) {
    const studentPk = await resolveStudentPk(record);
    if (studentPk == null) {
      unmatched++;
      continue;
    }

    const times = mapTimesForDuration(master.duration, record);
    const hasAnyTime = Boolean(
      times.am_time_in || times.am_time_out || times.pm_time_in || times.pm_time_out,
    );
    // Absent-only rows with no times: skip insert (roster remains local).
    if (!hasAnyTime) {
      skipped++;
      continue;
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT id, am_time_in, am_time_out, pm_time_in, pm_time_out
       FROM attendance WHERE student_id = ? AND event_id = ? LIMIT 1`,
      [studentPk, master.id],
    );

    if (existing.length > 0) {
      if (action === "skip") {
        skipped++;
        continue;
      }
      await pool.execute(
        `UPDATE attendance
         SET am_time_in = COALESCE(?, am_time_in),
             am_time_out = COALESCE(?, am_time_out),
             pm_time_in = COALESCE(?, pm_time_in),
             pm_time_out = COALESCE(?, pm_time_out)
         WHERE id = ?`,
        [
          times.am_time_in,
          times.am_time_out,
          times.pm_time_in,
          times.pm_time_out,
          existing[0].id,
        ],
      );
      updated++;
      continue;
    }

    await pool.execute<ResultSetHeader>(
      `INSERT INTO attendance
         (student_id, event_id, academic_period_id, am_time_in, am_time_out, pm_time_in, pm_time_out)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        studentPk,
        master.id,
        academicPeriodId,
        times.am_time_in,
        times.am_time_out,
        times.pm_time_in,
        times.pm_time_out,
      ],
    );
    created++;
  }

  const dept = opts.pkg.department.code;
  return {
    success: true,
    message: `Merged ${dept} attendance into "${master.name}". Created ${created}, updated ${updated}, skipped ${skipped}, unmatched ${unmatched}.`,
    eventId: master.id,
    created,
    updated,
    skipped,
    unmatched,
    preview,
  };
}
