import { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { Role } from "../types/express";

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
  audiences: string | null;
}

export const ADMIN_ROLES: Role[] = ["admin", "csg_president"];

/** `null` = institution-wide roster (admins/president). Otherwise restrict to programs in this department. */
export type AttendanceRosterDepartmentScope = number | null;

export async function selectScopedEvents(userRole: Role, userId: number): Promise<ScopedEventRow[]> {
  if (ADMIN_ROLES.includes(userRole)) {
    const [rows] = await pool.execute<ScopedEventRow[]>(
      `SELECT
        e.*,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      GROUP BY e.id
      ORDER BY e.date DESC`,
    );
    return rows;
  }

  const [userRows]: any = await pool.execute(
    `SELECT department_id FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (!userRows.length || !userRows[0].department_id) {
    return [];
  }
  const deptId = userRows[0].department_id;

  const [rows] = await pool.execute<ScopedEventRow[]>(
    `SELECT
      e.*,
      JSON_ARRAYAGG(
        JSON_OBJECT(
          'department_id',   ea.department_id,
          'department_name', d.name,
          'program_id',      ea.program_id,
          'course_code',     p.course_code,
          'course_name',     p.course_name,
          'year_level',      ea.year_level
        )
      ) AS audiences
    FROM events e
    LEFT JOIN event_audiences ea ON ea.event_id = e.id
      AND (e.is_all_departments = 1 OR ea.department_id = ?)
    LEFT JOIN departments d      ON d.id = ea.department_id
    LEFT JOIN programs p         ON p.id = ea.program_id
    WHERE e.is_all_departments = 1
      OR ea.department_id = ?
    GROUP BY e.id
    ORDER BY e.date DESC`,
    [deptId, deptId],
  );
  return rows;
}

/** Eligible roster size for an event (latest enrollment per student). */
export async function countEligibleStudents(
  eventId: number,
  scopeDepartmentId: AttendanceRosterDepartmentScope = null,
): Promise<number> {
  const [evRows]: any = await pool.execute(
    `SELECT is_all_departments FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!evRows.length) return 0;
  const isAll = Number(evRows[0].is_all_departments) === 1;

  if (isAll) {
    const [audRows]: any = await pool.execute(
      `SELECT year_level FROM event_audiences WHERE event_id = ? AND year_level IS NOT NULL LIMIT 1`,
      [eventId],
    );
    const scopedDept = scopeDepartmentId != null ? Number(scopeDepartmentId) : null;

    if (scopedDept != null) {
      if (!audRows.length) {
        const [rows]: any = await pool.execute(
          `SELECT COUNT(DISTINCT s.id) AS c
           FROM students s
           INNER JOIN enrollments en ON en.id = (
             SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
           )
           INNER JOIN programs p ON p.id = en.program_id
           WHERE p.department_id = ?`,
          [scopedDept],
        );
        return Number(rows[0]?.c ?? 0);
      }
      const yl = audRows[0].year_level;
      const [rows]: any = await pool.execute(
        `SELECT COUNT(DISTINCT s.id) AS c
         FROM students s
         INNER JOIN enrollments en ON en.id = (
           SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
         )
         INNER JOIN programs p ON p.id = en.program_id
         WHERE en.year_level = ? AND p.department_id = ?`,
        [yl, scopedDept],
      );
      return Number(rows[0]?.c ?? 0);
    }

    if (!audRows.length) {
      const [rows]: any = await pool.execute(
        `SELECT COUNT(DISTINCT s.id) AS c
         FROM students s
         INNER JOIN enrollments en ON en.student_id = s.id`,
      );
      return Number(rows[0]?.c ?? 0);
    }
    const yl = audRows[0].year_level;
    const [rows]: any = await pool.execute(
      `SELECT COUNT(DISTINCT s.id) AS c
       FROM students s
       INNER JOIN enrollments en ON en.student_id = s.id AND en.year_level = ?`,
      [yl],
    );
    return Number(rows[0]?.c ?? 0);
  }

  if (scopeDepartmentId != null) {
    const dept = Number(scopeDepartmentId);
    const [rows]: any = await pool.execute(
      `SELECT COUNT(DISTINCT s.id) AS c
       FROM students s
       INNER JOIN enrollments en ON en.id = (
         SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
       )
       INNER JOIN programs p ON p.id = en.program_id
       WHERE EXISTS (
         SELECT 1 FROM event_audiences ea
         WHERE ea.event_id = ?
           AND (ea.program_id IS NULL OR ea.program_id = en.program_id)
           AND (ea.year_level IS NULL OR ea.year_level = en.year_level)
       )
       AND p.department_id = ?`,
      [eventId, dept],
    );
    return Number(rows[0]?.c ?? 0);
  }

  const [rows]: any = await pool.execute(
    `SELECT COUNT(DISTINCT s.id) AS c
     FROM students s
     INNER JOIN enrollments en ON en.id = (
       SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
     )
     WHERE EXISTS (
       SELECT 1 FROM event_audiences ea
       WHERE ea.event_id = ?
         AND (ea.program_id IS NULL OR ea.program_id = en.program_id)
         AND (ea.year_level IS NULL OR ea.year_level = en.year_level)
     )`,
    [eventId],
  );
  return Number(rows[0]?.c ?? 0);
}

function attendedConditionSql(duration: string): string {
  switch (duration) {
    case "Whole Day":
      return `a.am_time_in IS NOT NULL AND a.pm_time_in IS NOT NULL`;
    case "AM Only":
      return `a.am_time_in IS NOT NULL`;
    case "PM Only":
      return `a.pm_time_in IS NOT NULL`;
    case "Half Day":
    default:
      return `(a.am_time_in IS NOT NULL OR a.pm_time_in IS NOT NULL)`;
  }
}

export async function countAttendedStudents(
  eventId: number,
  duration: string,
  scopeDepartmentId: AttendanceRosterDepartmentScope = null,
): Promise<number> {
  const cond = attendedConditionSql(duration);
  if (scopeDepartmentId == null) {
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
     INNER JOIN enrollments en ON en.id = (
       SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
     )
     INNER JOIN programs p ON p.id = en.program_id
     WHERE a.event_id = ? AND (${cond}) AND p.department_id = ?`,
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
  const [evRows]: any = await pool.execute(
    `SELECT is_all_departments FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  if (!evRows.length) return [];
  const isAll = Number(evRows[0].is_all_departments) === 1;
  const deptFilterSql =
    scopeDepartmentId != null ? " AND p.department_id = ? " : "";
  const deptParams: number[] =
    scopeDepartmentId != null ? [Number(scopeDepartmentId)] : [];

  if (isAll) {
    const [audRows]: any = await pool.execute(
      `SELECT year_level FROM event_audiences WHERE event_id = ? AND year_level IS NOT NULL LIMIT 1`,
      [eventId],
    );
    const baseSql = `SELECT
        s.id AS student_pk,
        s.student_id AS student_id,
        TRIM(CONCAT_WS(' ', s.first_name, NULLIF(TRIM(s.middle_name), ''), s.last_name)) AS full_name,
        p.course_code AS course_code,
        NULLIF(TRIM(p.major), '') AS major,
        a.am_time_in,
        a.am_time_out,
        a.pm_time_in,
        a.pm_time_out,
        (SELECT COALESCE(SUM(f.amount), 0) FROM fines f WHERE f.student_id = s.id AND f.event_id = ?) AS fine_total
       FROM students s
       INNER JOIN enrollments en ON en.id = (
         SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
       )
       INNER JOIN programs p ON p.id = en.program_id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.event_id = ?
       `;
    if (!audRows.length) {
      const [rows] = await pool.execute<EventStudentRow[]>(
        `${baseSql} WHERE 1=1 ${deptFilterSql} ORDER BY full_name ASC`,
        [eventId, eventId, ...deptParams],
      );
      return rows;
    }
    const yl = Number(audRows[0].year_level);
    const [rows] = await pool.execute<EventStudentRow[]>(
      `${baseSql} WHERE en.year_level = ? ${deptFilterSql} ORDER BY full_name ASC`,
      [eventId, eventId, yl, ...deptParams],
    );
    return rows;
  }

  const [rows] = await pool.execute<EventStudentRow[]>(
    `SELECT
      s.id AS student_pk,
      s.student_id AS student_id,
      TRIM(CONCAT_WS(' ', s.first_name, NULLIF(TRIM(s.middle_name), ''), s.last_name)) AS full_name,
      p.course_code AS course_code,
      NULLIF(TRIM(p.major), '') AS major,
      a.am_time_in,
      a.am_time_out,
      a.pm_time_in,
      a.pm_time_out,
      (SELECT COALESCE(SUM(f.amount), 0) FROM fines f WHERE f.student_id = s.id AND f.event_id = ?) AS fine_total
     FROM students s
     INNER JOIN enrollments en ON en.id = (
       SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
     )
     INNER JOIN programs p ON p.id = en.program_id
     LEFT JOIN attendance a ON a.student_id = s.id AND a.event_id = ?
     WHERE EXISTS (
       SELECT 1 FROM event_audiences ea
       WHERE ea.event_id = ?
         AND (ea.program_id IS NULL OR ea.program_id = en.program_id)
         AND (ea.year_level IS NULL OR ea.year_level = en.year_level)
     )
     ${deptFilterSql}
     ORDER BY full_name ASC`,
    [eventId, eventId, eventId, ...deptParams],
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
  try {
    const aud = eventRow.audiences ? JSON.parse(eventRow.audiences as unknown as string) : [];
    if (!Array.isArray(aud)) return false;
    return aud.some(
      (a: { department_id?: number | null }) =>
        a?.department_id != null && Number(a.department_id) === Number(departmentId),
    );
  } catch {
    return false;
  }
}
