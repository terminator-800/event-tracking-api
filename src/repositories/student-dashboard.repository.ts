import { RowDataPacket } from "mysql2";
import { pool } from "../config/db";

export interface StudentListRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  full_name: string;
  course_code: string;
  major: string | null;
  department_id: number;
  total_events: number;
  events_attended: number;
}

/** Latest enrollment per student + program + stats vs completed eligible events. */
export async function findStudentsWithAttendanceStats(
  departmentId: number | null,
): Promise<StudentListRow[]> {
  const deptClause = departmentId == null ? "1=1" : "p.department_id = ?";
  const params: (string | number)[] = [];
  if (departmentId != null) params.push(departmentId);

  const [rows] = await pool.execute<StudentListRow[]>(
    `
    SELECT
      s.id AS student_pk,
      s.student_id AS student_id,
      TRIM(CONCAT_WS(' ', s.first_name, NULLIF(TRIM(s.middle_name), ''), s.last_name)) AS full_name,
      p.course_code AS course_code,
      p.major AS major,
      p.department_id AS department_id,
      COUNT(DISTINCT CASE
        WHEN ev.id IS NOT NULL
         AND (
          (ev.is_all_departments = 1 AND (
            NOT EXISTS (
              SELECT 1 FROM event_audiences ea0
              WHERE ea0.event_id = ev.id AND ea0.year_level IS NOT NULL
            )
            OR EXISTS (
              SELECT 1 FROM event_audiences ea1
              WHERE ea1.event_id = ev.id
                AND (ea1.year_level IS NULL OR ea1.year_level = en.year_level)
            )
          ))
          OR EXISTS (
            SELECT 1 FROM event_audiences ea2
            WHERE ea2.event_id = ev.id
              AND ea2.program_id = en.program_id
              AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
          )
        )
        THEN ev.id
      END) AS total_events,
      COUNT(DISTINCT CASE
        WHEN ev.id IS NOT NULL
         AND (
          (ev.is_all_departments = 1 AND (
            NOT EXISTS (
              SELECT 1 FROM event_audiences ea0
              WHERE ea0.event_id = ev.id AND ea0.year_level IS NOT NULL
            )
            OR EXISTS (
              SELECT 1 FROM event_audiences ea1
              WHERE ea1.event_id = ev.id
                AND (ea1.year_level IS NULL OR ea1.year_level = en.year_level)
            )
          ))
          OR EXISTS (
            SELECT 1 FROM event_audiences ea2
            WHERE ea2.event_id = ev.id
              AND ea2.program_id = en.program_id
              AND (ea2.year_level IS NULL OR ea2.year_level = en.year_level)
          )
        )
        AND att.id IS NOT NULL
        AND (att.am_time_in IS NOT NULL OR att.pm_time_in IS NOT NULL)
        THEN ev.id
      END) AS events_attended
    FROM students s
    INNER JOIN enrollments en ON en.id = (
      SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
    )
    INNER JOIN programs p ON p.id = en.program_id
    LEFT JOIN events ev ON ev.status = 'Completed'
    LEFT JOIN attendance att ON att.event_id = ev.id AND att.student_id = s.id
    WHERE ${deptClause}
    GROUP BY s.id, s.student_id, s.first_name, s.middle_name, s.last_name, p.course_code, p.major, p.department_id, en.id, en.year_level
    ORDER BY full_name ASC
    `,
    params.length ? params : undefined,
  );
  return rows;
}

export interface EventHistoryDbRow extends RowDataPacket {
  event_id: number;
  name: string;
  date: string;
  duration: string;
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
  attended: number;
  fine_php: string | null;
}

export async function findCompletedEventsForStudent(
  studentPk: number,
  enrollmentProgramId: number,
  enrollmentYearLevel: number,
): Promise<EventHistoryDbRow[]> {
  const [rows] = await pool.execute<EventHistoryDbRow[]>(
    `
    SELECT
      ev.id AS event_id,
      ev.name AS name,
      DATE_FORMAT(ev.date, '%Y-%m-%d') AS date,
      ev.duration AS duration,
      att.am_time_in,
      att.am_time_out,
      att.pm_time_in,
      att.pm_time_out,
      CASE
        WHEN att.id IS NOT NULL AND (att.am_time_in IS NOT NULL OR att.pm_time_in IS NOT NULL) THEN 1
        ELSE 0
      END AS attended,
      (
        SELECT COALESCE(SUM(f.amount), 0)
        FROM fines f
        WHERE f.student_id = ? AND f.event_id = ev.id
      ) AS fine_php
    FROM events ev
    LEFT JOIN attendance att ON att.event_id = ev.id AND att.student_id = ?
    WHERE ev.status = 'Completed'
      AND (
        (ev.is_all_departments = 1 AND (
          NOT EXISTS (
            SELECT 1 FROM event_audiences ea0
            WHERE ea0.event_id = ev.id AND ea0.year_level IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM event_audiences ea1
            WHERE ea1.event_id = ev.id
              AND (ea1.year_level IS NULL OR ea1.year_level = ?)
          )
        ))
        OR EXISTS (
          SELECT 1 FROM event_audiences ea2
          WHERE ea2.event_id = ev.id
            AND ea2.program_id = ?
            AND (ea2.year_level IS NULL OR ea2.year_level = ?)
        )
      )
    ORDER BY ev.date DESC, ev.id DESC
    `,
    [studentPk, studentPk, enrollmentYearLevel, enrollmentProgramId, enrollmentYearLevel],
  );
  return rows;
}

export async function findStudentEnrollmentContext(studentPk: number): Promise<{
  program_id: number;
  year_level: number;
  course_code: string;
  major: string | null;
} | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT en.program_id, en.year_level, p.course_code, p.major
    FROM enrollments en
    INNER JOIN programs p ON p.id = en.program_id
    WHERE en.student_id = ?
    ORDER BY en.id DESC
    LIMIT 1
    `,
    [studentPk],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    program_id: Number(r.program_id),
    year_level: Number(r.year_level),
    course_code: String(r.course_code),
    major: r.major == null ? null : String(r.major),
  };
}

export async function resolveStudentPkByPublicId(publicStudentId: string): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
    [publicStudentId],
  );
  return rows[0] ? Number((rows[0] as { id: number }).id) : null;
}
