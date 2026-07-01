import { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { Role } from "../types/express";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL } from "../utils/studentDisplaySql";
import {
  buildEligibleStudentsQuery,
  sqlLatestEnrollmentLeftJoin,
  SQL_LATEST_PROGRAM_LEFT_JOIN,
  sqlActivePeriodEventsClause,
} from "../utils/studentEligibilitySql";
import { getActiveAcademicPeriod } from "./academic-periods.repository";

export interface ScopedEventRow extends RowDataPacket {
  id: number;
  name: string;
  date: string;
  venue: string;
  duration: string;
  status: string;
  fine_amount: string | number;
  is_all_departments: number;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  am_grace_in: number;
  am_grace_out: number;
  pm_grace_in: number;
  pm_grace_out: number;
  audience_notes: string | null;
  audiences: string | null;
}

export const ADMIN_ROLES: Role[] = ["admin", "csg_president"];

/** `null` = institution-wide roster (admins/president). Otherwise restrict to programs in this department. */
export type AttendanceRosterDepartmentScope = number | null;

/** Same source as scoped event list — use when JWT may omit department_id */
export async function getUserDepartmentIdForAttendance(userId: number): Promise<number | null> {
  const [userRows]: any = await pool.execute(
    `SELECT department_id FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (!userRows.length || userRows[0].department_id == null) return null;
  const n = Number(userRows[0].department_id);
  return Number.isFinite(n) ? n : null;
}

function parseAudienceEntries(raw: unknown): Array<{ department_id?: unknown }> {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is { department_id?: unknown } =>
      item != null && typeof item === "object",
    );
  }
  if (Buffer.isBuffer(raw)) {
    return parseAudienceEntries(raw.toString("utf8"));
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s) as unknown;
      return parseAudienceEntries(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export async function selectScopedEvents(userRole: Role, userId: number): Promise<ScopedEventRow[]> {
  const activePeriod = await getActiveAcademicPeriod();
  const periodClause = activePeriod ? sqlActivePeriodEventsClause("e") : "";
  const periodParams = activePeriod ? [activePeriod.id] : [];
  const audienceAggSql = `JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'department_code', d.code,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'major',           NULLIF(TRIM(p.major), ''),
            'year_level',      ea.year_level
          )
        ) AS audiences`;

  if (userRole === "admin") {
    const [rows] = await pool.execute<ScopedEventRow[]>(
      `SELECT
        e.*,
        ${audienceAggSql}
      FROM events e
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE 1=1${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      periodParams,
    );
    return rows;
  }

  if (userRole === "csg_president") {
    const [rows] = await pool.execute<ScopedEventRow[]>(
      `SELECT
        e.*,
        ${audienceAggSql}
      FROM events e
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE e.created_by = ?${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      [userId, ...periodParams],
    );
    return rows;
  }

  const deptId = await getUserDepartmentIdForAttendance(userId);
  if (deptId == null) {
    return [];
  }

  const [rows] = await pool.execute<ScopedEventRow[]>(
    `SELECT
      e.*,
      ${audienceAggSql}
    FROM events e
    LEFT JOIN event_audiences ea ON ea.event_id = e.id
      AND (e.is_all_departments = 1 OR ea.department_id = ?)
    LEFT JOIN departments d      ON d.id = ea.department_id
    LEFT JOIN programs p         ON p.id = ea.program_id
    WHERE (e.is_all_departments = 1 OR ea.department_id = ?)
      AND e.created_by = ?${periodClause}
    GROUP BY e.id
    ORDER BY e.date DESC`,
    [deptId, deptId, userId, ...periodParams],
  );
  return rows;
}

async function getEventAudienceYearLevel(eventId: number): Promise<number | null> {
  const [audRows]: any = await pool.execute(
    `SELECT year_level FROM event_audiences WHERE event_id = ? AND year_level IS NOT NULL LIMIT 1`,
    [eventId],
  );
  if (!audRows.length) return null;
  const yl = Number(audRows[0].year_level);
  return Number.isFinite(yl) ? yl : null;
}

/** Eligible roster size — students table first; enrollment optional for CSV imports. */
export async function countEligibleStudents(
  eventId: number,
  scopeDepartmentId: AttendanceRosterDepartmentScope = null,
): Promise<number> {
  const activePeriod = await getActiveAcademicPeriod();
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(activePeriod?.id ?? null);
  const [evRows]: any = await pool.execute(
    `SELECT is_all_departments FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!evRows.length) return 0;
  const isAll = Number(evRows[0].is_all_departments) === 1;
  const audienceYearLevel = await getEventAudienceYearLevel(eventId);
  const { sql, params } = buildEligibleStudentsQuery(
    eventId,
    isAll,
    audienceYearLevel,
    activePeriod?.id ?? null,
  );

  if (isAll) {
    const [rows]: any = await pool.execute(
      `SELECT COUNT(*) AS c FROM (${sql}) eligible`,
      params,
    );
    return Number(rows[0]?.c ?? 0);
  }

  if (scopeDepartmentId != null) {
    const dept = Number(scopeDepartmentId);
    const [rows]: any = await pool.execute(
      `SELECT COUNT(*) AS c
       FROM (${sql}) eligible
       INNER JOIN students s ON s.id = eligible.student_id
       ${enrollmentJoin}
       ${SQL_LATEST_PROGRAM_LEFT_JOIN}
       WHERE en.id IS NULL OR p.department_id = ?`,
      [...params, dept],
    );
    return Number(rows[0]?.c ?? 0);
  }

  const [rows]: any = await pool.execute(`SELECT COUNT(*) AS c FROM (${sql}) eligible`, params);
  return Number(rows[0]?.c ?? 0);
}

/**
 * Must match `studentAttended` in attendance-page.controller.ts:
 * any recorded time in/out in any slot counts as attended for totals and absence math.
 */
function attendedConditionSql(_duration: string): string {
  return `(a.am_time_in IS NOT NULL OR a.am_time_out IS NOT NULL OR a.pm_time_in IS NOT NULL OR a.pm_time_out IS NOT NULL)`;
}

export async function countAttendedStudents(
  eventId: number,
  duration: string,
  scopeDepartmentId: AttendanceRosterDepartmentScope = null,
): Promise<number> {
  const activePeriod = await getActiveAcademicPeriod();
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(activePeriod?.id ?? null);
  const cond = attendedConditionSql(duration);
  if (scopeDepartmentId == null) {
    const [rows]: any = await pool.execute(
      `SELECT COUNT(*) AS c FROM attendance a WHERE a.event_id = ? AND (${cond})`,
      [eventId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  const [evRows]: any = await pool.execute(
    `SELECT is_all_departments FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (evRows.length && Number(evRows[0].is_all_departments) === 1) {
    const [rows]: any = await pool.execute(
      `SELECT COUNT(*) AS c FROM attendance a WHERE a.event_id = ? AND (${cond})`,
      [eventId],
    );
    return Number(rows[0]?.c ?? 0);
  }

  const dept = Number(scopeDepartmentId);
  const [rows]: any = await pool.execute(
    `SELECT COUNT(*) AS c
     FROM attendance a
     INNER JOIN students s ON s.id = a.student_id
     ${enrollmentJoin}
     ${SQL_LATEST_PROGRAM_LEFT_JOIN}
     WHERE a.event_id = ? AND (${cond}) AND en.id IS NOT NULL AND p.department_id = ?`,
    [eventId, dept],
  );
  return Number(rows[0]?.c ?? 0);
}

export interface EventStudentRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  full_name: string;
  course_code: string;
  major: string | null;
  department_name: string | null;
  year_level: number | string | null;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  fine_total: string | number | null;
}

export async function selectStudentsForEventDetail(
  eventId: number,
  scopeDepartmentId: AttendanceRosterDepartmentScope = null,
): Promise<EventStudentRow[]> {
  const activePeriod = await getActiveAcademicPeriod();
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(activePeriod?.id ?? null);
  const [evRows]: any = await pool.execute(
    `SELECT is_all_departments FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!evRows.length) return [];
  const isAll = Number(evRows[0].is_all_departments) === 1;
  const audienceYearLevel = await getEventAudienceYearLevel(eventId);
  const { sql: eligibleSql, params: eligibleParams } = buildEligibleStudentsQuery(
    eventId,
    isAll,
    audienceYearLevel,
    activePeriod?.id ?? null,
  );

  const baseSql = `SELECT
      s.id AS student_pk,
      s.student_id AS student_id,
      ${SQL_STUDENT_FULL_NAME} AS full_name,
      p.course_code AS course_code,
      NULLIF(TRIM(p.major), '') AS major,
      d.name AS department_name,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
      a.am_time_in,
      a.am_time_out,
      a.pm_time_in,
      a.pm_time_out,
      (SELECT COALESCE(SUM(f.amount), 0) FROM fines f WHERE f.student_id = s.id AND f.event_id = ?) AS fine_total
     FROM students s
     ${enrollmentJoin}
     ${SQL_LATEST_PROGRAM_LEFT_JOIN}
     LEFT JOIN departments d ON d.id = p.department_id
     INNER JOIN (${eligibleSql}) eligible ON eligible.student_id = s.id
     LEFT JOIN attendance a ON a.student_id = s.id AND a.event_id = ?`;

  if (isAll || scopeDepartmentId == null) {
    const [rows] = await pool.execute<EventStudentRow[]>(
      `${baseSql} ORDER BY full_name ASC`,
      [eventId, ...eligibleParams, eventId],
    );
    return rows;
  }

  const dept = Number(scopeDepartmentId);
  const [rows] = await pool.execute<EventStudentRow[]>(
    `${baseSql} WHERE en.id IS NULL OR p.department_id = ? ORDER BY full_name ASC`,
    [eventId, ...eligibleParams, eventId, dept],
  );
  return rows;
}

export function userCanAccessEvent(
  eventRow: ScopedEventRow,
  userRole: Role,
  departmentId: number | null,
): boolean {
  if (ADMIN_ROLES.includes(userRole)) return true;
  if (!departmentId) return false;
  if (Number(eventRow.is_all_departments) === 1) return true;
  const aud = parseAudienceEntries(eventRow.audiences as unknown);
  return aud.some(
    (a) => a?.department_id != null && Number(a.department_id) === Number(departmentId),
  );
}
