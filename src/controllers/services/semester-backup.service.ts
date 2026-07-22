// eslint-disable-next-line @typescript-eslint/no-require-imports
const XlsxPopulate: any = require("xlsx-populate");

import { RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import { getAcademicPeriodById } from "../../repositories/academic-periods.repository";
import { selectStudentsForEventDetail } from "../../repositories/attendance-page.repository";
import {
  SQL_STUDENT_DEPARTMENT_NAME,
  SQL_STUDENT_FULL_NAME,
  SQL_STUDENT_YEAR_LEVEL,
} from "../../utils/studentDisplaySql";
import {
  SQL_LATEST_PROGRAM_LEFT_JOIN,
  sqlLatestEnrollmentLeftJoin,
} from "../../utils/studentEligibilitySql";
import { sqlTimeTo12Hour } from "../../utils/sqlTime";
import {
  isCsgCashierRole,
  isDeptCashierRole,
  isGovernorRole,
  SQL_CSG_PRESIDENT_CREATOR,
} from "../../utils/roles";
import type { Role } from "../../types/express";

/** How events are selected for backup — mirrors Manage Events creator rules. */
export type BackupCreatorMode = "all" | "own" | "csg_presidents" | "department_creators";

export type BackupDepartmentScope = {
  departmentId: number | null;
  departmentCode: string | null;
  departmentName: string | null;
  scopeLabel: string;
  creatorMode: BackupCreatorMode;
};

export type ResolvedBackupScope = {
  needsDepartment: boolean;
  departmentId: number | null;
  creatorMode: BackupCreatorMode;
  creatorUserId: number | null;
};

/**
 * Events: filtered by who created them (same idea as Manage Events).
 * Attendance / collection for college desks still use departmentId for student scope.
 */
export function resolveBackupScope(
  role: Role | string | null | undefined,
  userId: number,
  departmentId: number | null | undefined,
): ResolvedBackupScope {
  const r = String(role ?? "").trim().toLowerCase();
  const deptId =
    departmentId != null && Number.isFinite(Number(departmentId))
      ? Number(departmentId)
      : null;

  if (r === "admin" || r === "super_admin") {
    return {
      needsDepartment: false,
      departmentId: null,
      creatorMode: "all",
      creatorUserId: null,
    };
  }
  if (r === "csg_president") {
    return {
      needsDepartment: false,
      departmentId: null,
      creatorMode: "own",
      creatorUserId: userId,
    };
  }
  if (isCsgCashierRole(role, departmentId)) {
    return {
      needsDepartment: false,
      departmentId: null,
      creatorMode: "csg_presidents",
      creatorUserId: null,
    };
  }
  if (isGovernorRole(role)) {
    return {
      needsDepartment: true,
      departmentId: deptId,
      creatorMode: "own",
      creatorUserId: userId,
    };
  }
  if (isDeptCashierRole(role, departmentId)) {
    return {
      needsDepartment: true,
      departmentId: deptId,
      creatorMode: "department_creators",
      creatorUserId: null,
    };
  }
  if (deptId != null) {
    return {
      needsDepartment: true,
      departmentId: deptId,
      creatorMode: "department_creators",
      creatorUserId: null,
    };
  }
  return {
    needsDepartment: false,
    departmentId: null,
    creatorMode: "all",
    creatorUserId: null,
  };
}

/** @deprecated Prefer resolveBackupScope */
export function resolveBackupDepartmentScope(
  role: Role | string | null | undefined,
  departmentId: number | null | undefined,
): { needsDepartment: boolean; departmentId: number | null } {
  const resolved = resolveBackupScope(role, 0, departmentId);
  return {
    needsDepartment: resolved.needsDepartment,
    departmentId: resolved.departmentId,
  };
}

async function loadDepartmentMeta(
  departmentId: number | null,
): Promise<{ departmentCode: string | null; departmentName: string | null }> {
  if (departmentId == null) {
    return { departmentCode: null, departmentName: null };
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT code, name FROM departments WHERE id = ? LIMIT 1`,
    [departmentId],
  );
  const code = rows[0]?.code != null ? String(rows[0].code).trim() : null;
  const name = rows[0]?.name != null ? String(rows[0].name).trim() : null;
  return { departmentCode: code, departmentName: name };
}

function buildScopeLabel(
  creatorMode: BackupCreatorMode,
  deptMeta: { departmentCode: string | null; departmentName: string | null },
): string {
  const dept = deptMeta.departmentCode || deptMeta.departmentName;
  switch (creatorMode) {
    case "all":
      return "All events (all creators)";
    case "own":
      return dept ? `Events I created (${dept})` : "Events I created";
    case "csg_presidents":
      return "Events created by CSG President";
    case "department_creators":
      return dept
        ? `Events created by ${dept} accounts`
        : "Events created by department accounts";
    default:
      return "All events";
  }
}

const GREEN = "07713C";
const HEADER_TEXT = "FFFFFF";
const ALT_ROW = "F1FAF4";

function styleHeader(cell: any) {
  cell.style("bold", true);
  cell.style("fill", { type: "solid", color: GREEN });
  cell.style("fontColor", HEADER_TEXT);
  cell.style("horizontalAlignment", "center");
  cell.style("wrapText", false);
}

function styleAltRow(sheet: any, rowIdx: number, colCount: number) {
  if (rowIdx % 2 === 0) return;
  for (let c = 1; c <= colCount; c++) {
    try {
      sheet.cell(rowIdx, c).style("fill", { type: "solid", color: ALT_ROW });
    } catch {
      /* ignore */
    }
  }
}

function writeSheet(
  sheet: any,
  headers: string[],
  rows: Array<Array<string | number | null>>,
) {
  headers.forEach((h, i) => {
    const cell = sheet.cell(1, i + 1);
    cell.value(h);
    styleHeader(cell);
  });
  rows.forEach((row, rIdx) => {
    const excelRow = rIdx + 2;
    row.forEach((val, cIdx) => {
      sheet.cell(excelRow, cIdx + 1).value(val ?? "");
    });
    styleAltRow(sheet, excelRow, headers.length);
  });
  headers.forEach((_, i) => {
    try {
      sheet.column(i + 1).width(Math.min(36, Math.max(12, String(headers[i]).length + 4)));
    } catch {
      /* ignore */
    }
  });
}

function sanitizeFilePart(str: string, maxLen = 40): string {
  return String(str ?? "")
    .replace(/[^a-zA-Z0-9\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, maxLen);
}

async function loadEvents(
  periodId: number,
  creatorMode: BackupCreatorMode,
  creatorUserId: number | null,
  departmentId: number | null,
): Promise<RowDataPacket[]> {
  const params: (string | number)[] = [periodId];
  let creatorClause = "";
  if (creatorMode === "own" && creatorUserId != null) {
    creatorClause = " AND e.created_by = ? ";
    params.push(creatorUserId);
  } else if (creatorMode === "csg_presidents") {
    creatorClause = ` AND ${SQL_CSG_PRESIDENT_CREATOR} `;
  } else if (creatorMode === "department_creators" && departmentId != null) {
    creatorClause =
      " AND e.created_by IN (SELECT cu.id FROM users cu WHERE cu.department_id = ?) ";
    params.push(departmentId);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      e.id,
      e.event_uuid,
      e.name,
      DATE_FORMAT(e.date, '%Y-%m-%d') AS date,
      e.venue,
      e.duration,
      e.event_mode,
      e.status,
      e.fine_amount,
      e.is_all_departments,
      e.audience_notes,
      u.username AS created_by
    FROM events e
    LEFT JOIN users u ON u.id = e.created_by
    WHERE e.academic_period_id = ?
      ${creatorClause}
    ORDER BY e.date ASC, e.id ASC
    `,
    params,
  );
  return rows;
}

type AttendanceBackupRow = {
  event_id: number;
  event_name: string;
  event_date: string;
  event_status: string;
  student_id: string;
  student_name: string;
  department_name: string;
  course_code: string;
  major: string;
  year_level: number | string;
  am_time_in: string;
  am_time_out: string;
  pm_time_in: string;
  pm_time_out: string;
  attendance_status: string;
  fine_total: number;
};

/** Full eligible roster per event (same as Attendance Management), including Absent / No record. */
async function loadAttendance(
  periodId: number,
  events: RowDataPacket[],
  departmentScope: number | null,
): Promise<AttendanceBackupRow[]> {
  const out: AttendanceBackupRow[] = [];
  for (const ev of events) {
    const eventId = Number(ev.id);
    if (!Number.isFinite(eventId)) continue;
    const eventStatus = String(ev.status ?? "");
    const isUpcoming = eventStatus.toLowerCase() === "upcoming";
    const students = await selectStudentsForEventDetail(eventId, departmentScope, periodId);
    for (const s of students) {
      const hasAnyTime =
        s.am_time_in != null ||
        s.am_time_out != null ||
        s.pm_time_in != null ||
        s.pm_time_out != null;
      const attendanceStatus = isUpcoming
        ? hasAnyTime
          ? "Attended"
          : "No record"
        : hasAnyTime
          ? "Attended"
          : "Absent";
      out.push({
        event_id: eventId,
        event_name: String(ev.name ?? ""),
        event_date: String(ev.date ?? ""),
        event_status: eventStatus,
        student_id: String(s.student_id ?? ""),
        student_name: String(s.full_name ?? ""),
        department_name: s.department_name != null ? String(s.department_name) : "",
        course_code: s.course_code != null ? String(s.course_code) : "",
        major: s.major != null ? String(s.major) : "",
        year_level: s.year_level != null && s.year_level !== "" ? Number(s.year_level) || String(s.year_level) : "",
        am_time_in: sqlTimeTo12Hour(s.am_time_in) ?? "",
        am_time_out: sqlTimeTo12Hour(s.am_time_out) ?? "",
        pm_time_in: sqlTimeTo12Hour(s.pm_time_in) ?? "",
        pm_time_out: sqlTimeTo12Hour(s.pm_time_out) ?? "",
        attendance_status: attendanceStatus,
        fine_total: Number(s.fine_total) || 0,
      });
    }
  }
  return out;
}

async function loadCollection(
  periodId: number,
  departmentScope: number | null,
): Promise<RowDataPacket[]> {
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(periodId);
  const params: (string | number)[] = [periodId];
  let deptSql = "";
  if (departmentScope != null) {
    deptSql = " AND p.department_id = ? ";
    params.push(departmentScope);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      pt.transaction_code,
      DATE_FORMAT(pt.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
      s.student_id AS student_id,
      ${SQL_STUDENT_FULL_NAME} AS student_name,
      ${SQL_STUDENT_DEPARTMENT_NAME} AS department_name,
      p.course_code AS course_code,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
      pt.total_amount_paid,
      pt.payment_method,
      pt.status,
      pt.previous_balance,
      pt.balance_after,
      pt.remarks,
      COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS encoded_by
    FROM payment_transactions pt
    INNER JOIN students s ON s.id = pt.student_id
    ${enrollmentJoin}
    ${SQL_LATEST_PROGRAM_LEFT_JOIN}
    LEFT JOIN departments d ON d.id = p.department_id
    LEFT JOIN users u ON u.id = pt.paid_by_user_id
    WHERE pt.academic_period_id = ?
      ${deptSql}
    ORDER BY pt.paid_at DESC, pt.id DESC
    `,
    params,
  );
  return rows;
}

export type SemesterBackupResult = {
  buffer: Buffer;
  filename: string;
  counts: {
    events: number;
    attendance: number;
    collection: number;
  };
  period: {
    id: number;
    school_year: string;
    semester: string;
    status: string;
  };
  scope: BackupDepartmentScope;
};

export async function generateSemesterBackup(opts: {
  periodId: number;
  departmentId: number | null;
  creatorMode: BackupCreatorMode;
  creatorUserId: number | null;
}): Promise<SemesterBackupResult> {
  const { periodId, departmentId, creatorMode, creatorUserId } = opts;
  const period = await getAcademicPeriodById(periodId);
  if (!period) {
    throw Object.assign(new Error("Academic period not found."), { status: 404 });
  }

  const deptMeta = await loadDepartmentMeta(departmentId);
  const scope: BackupDepartmentScope = {
    departmentId,
    ...deptMeta,
    creatorMode,
    scopeLabel: buildScopeLabel(creatorMode, deptMeta),
  };

  const events = await loadEvents(periodId, creatorMode, creatorUserId, departmentId);
  const [attendance, collection] = await Promise.all([
    loadAttendance(periodId, events, departmentId),
    loadCollection(periodId, departmentId),
  ]);

  const workbook = await XlsxPopulate.fromBlankAsync();

  const summary = workbook.sheet(0);
  summary.name("Summary");
  writeSheet(
    summary,
    ["Field", "Value"],
    [
      ["School Year", period.school_year],
      ["Semester", period.semester],
      ["Period Status", period.status],
      ["Period ID", period.id],
      ["Backup Scope", scope.scopeLabel],
      ["Event Creator Filter", creatorMode],
      ["Department Code", scope.departmentCode ?? "—"],
      ["Department Name", scope.departmentName ?? "—"],
      ["Generated At", new Date().toISOString()],
      ["Events Count", events.length],
      ["Attendance Records", attendance.length],
      ["Collection Transactions", collection.length],
    ],
  );

  const eventsSheet = workbook.addSheet("Events");
  writeSheet(
    eventsSheet,
    [
      "Event ID",
      "Event UUID",
      "Name",
      "Date",
      "Venue",
      "Duration",
      "Mode",
      "Status",
      "Fine Amount",
      "All Departments",
      "Audience Notes",
      "Created By",
    ],
    events.map((e) => [
      Number(e.id),
      String(e.event_uuid ?? ""),
      String(e.name ?? ""),
      String(e.date ?? ""),
      String(e.venue ?? ""),
      String(e.duration ?? ""),
      String(e.event_mode ?? ""),
      String(e.status ?? ""),
      Number(e.fine_amount) || 0,
      Number(e.is_all_departments) === 1 ? "Yes" : "No",
      e.audience_notes != null ? String(e.audience_notes) : "",
      String(e.created_by ?? ""),
    ]),
  );

  const attendanceSheet = workbook.addSheet("Attendance");
  writeSheet(
    attendanceSheet,
    [
      "Event ID",
      "Event Name",
      "Event Date",
      "Event Status",
      "Student ID",
      "Student Name",
      "Department",
      "Course",
      "Major",
      "Year Level",
      "AM Time In",
      "AM Time Out",
      "PM Time In",
      "PM Time Out",
      "Status",
      "Fine",
    ],
    attendance.map((a) => [
      a.event_id,
      a.event_name,
      a.event_date,
      a.event_status,
      a.student_id,
      a.student_name,
      a.department_name,
      a.course_code,
      a.major,
      a.year_level,
      a.am_time_in,
      a.am_time_out,
      a.pm_time_in,
      a.pm_time_out,
      a.attendance_status,
      a.fine_total,
    ]),
  );

  const collectionSheet = workbook.addSheet("Collection");
  writeSheet(
    collectionSheet,
    [
      "Transaction Code",
      "Paid At",
      "Student ID",
      "Student Name",
      "Department",
      "Course",
      "Year Level",
      "Amount Paid",
      "Payment Method",
      "Status",
      "Previous Balance",
      "Balance After",
      "Remarks",
      "Encoded By",
    ],
    collection.map((c) => [
      String(c.transaction_code ?? ""),
      String(c.paid_at ?? ""),
      String(c.student_id ?? ""),
      String(c.student_name ?? ""),
      String(c.department_name ?? ""),
      String(c.course_code ?? ""),
      c.year_level != null ? Number(c.year_level) : "",
      Number(c.total_amount_paid) || 0,
      String(c.payment_method ?? ""),
      String(c.status ?? ""),
      c.previous_balance != null ? Number(c.previous_balance) : "",
      c.balance_after != null ? Number(c.balance_after) : "",
      c.remarks != null ? String(c.remarks) : "",
      String(c.encoded_by ?? ""),
    ]),
  );

  const buffer = Buffer.from(await workbook.outputAsync());
  const sy = sanitizeFilePart(period.school_year, 20);
  const sem = sanitizeFilePart(period.semester, 12);
  const deptPart = scope.departmentCode
    ? `_${sanitizeFilePart(scope.departmentCode, 12)}`
    : "";
  const filename = `backup_${sy}_${sem}${deptPart}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return {
    buffer,
    filename,
    counts: {
      events: events.length,
      attendance: attendance.length,
      collection: collection.length,
    },
    period: {
      id: period.id,
      school_year: period.school_year,
      semester: period.semester,
      status: period.status,
    },
    scope,
  };
}
