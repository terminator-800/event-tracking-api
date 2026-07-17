import { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL } from "../utils/studentDisplaySql";
import { sqlLatestEnrollmentLeftJoin } from "../utils/studentEligibilitySql";
import { getActiveAcademicPeriod } from "./academic-periods.repository";

export interface StudentListRow extends RowDataPacket {
  student_pk: number;
  student_id: string;
  full_name: string;
  course_code: string;
  major: string | null;
  department_id: number;
  department_name: string | null;
  year_level: number | string | null;
  total_events: number;
  events_attended: number;
}

/** Latest enrollment per student + program + stats vs completed eligible events.
 * When {@link createdByUserId} is set, only counts events that user created (`events.created_by`).
 * Scoped to the active academic period roster and events. */
export async function findStudentsWithAttendanceStats(
  departmentId: number | null,
  createdByUserId: number | null = null,
): Promise<StudentListRow[]> {
  const activePeriod = await getActiveAcademicPeriod();
  const academicPeriodId = activePeriod?.id ?? null;
  if (academicPeriodId == null) return [];

  const deptClause = departmentId == null ? "en.id IS NOT NULL" : "en.id IS NOT NULL AND p.department_id = ?";
  const eventCreatorClause =
    createdByUserId != null ? " AND ev.created_by = ? " : "";
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);

  const params: (string | number)[] = [academicPeriodId];
  if (createdByUserId != null) params.push(createdByUserId);
  if (departmentId != null) params.push(departmentId);

  const [rows] = await pool.execute<StudentListRow[]>(
    `
    SELECT
      s.id AS student_pk,
      s.student_id AS student_id,
      ${SQL_STUDENT_FULL_NAME} AS full_name,
      p.course_code AS course_code,
      p.major AS major,
      p.department_id AS department_id,
      d.name AS department_name,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
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
                AND (
                  ea1.year_level IS NULL
                  OR CAST(ea1.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                  OR EXISTS (
                    SELECT 1 FROM attendance ay1
                    WHERE ay1.event_id = ev.id AND ay1.student_id = s.id
                  )
                  OR EXISTS (
                    SELECT 1 FROM fines fz1
                    WHERE fz1.event_id = ev.id AND fz1.student_id = s.id
                  )
                )
            )
          ))
          OR EXISTS (
            SELECT 1 FROM event_audiences ea2
            WHERE ea2.event_id = ev.id
              AND (ea2.department_id IS NULL OR ea2.department_id = p.department_id)
              AND (ea2.program_id IS NULL OR ea2.program_id = en.program_id)
              AND (
                ea2.year_level IS NULL
                OR CAST(ea2.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                OR EXISTS (
                  SELECT 1 FROM attendance ay2
                  WHERE ay2.event_id = ev.id AND ay2.student_id = s.id
                )
                OR EXISTS (
                  SELECT 1 FROM fines fz2
                  WHERE fz2.event_id = ev.id AND fz2.student_id = s.id
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM event_audiences ea_m
            INNER JOIN programs p_a ON p_a.id = ea_m.program_id
            WHERE ea_m.event_id = ev.id
              AND ea_m.program_id IS NOT NULL
              AND ea_m.program_id <> en.program_id
              AND UPPER(TRIM(p_a.course_code)) = UPPER(TRIM(p.course_code))
              AND LOWER(TRIM(COALESCE(p_a.major, ''))) = LOWER(TRIM(COALESCE(p.major, '')))
              AND (ea_m.department_id IS NULL OR ea_m.department_id = p.department_id)
              AND (
                ea_m.year_level IS NULL
                OR CAST(ea_m.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                OR EXISTS (
                  SELECT 1 FROM attendance ay3
                  WHERE ay3.event_id = ev.id AND ay3.student_id = s.id
                )
                OR EXISTS (
                  SELECT 1 FROM fines fz3
                  WHERE fz3.event_id = ev.id AND fz3.student_id = s.id
                )
              )
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
                AND (
                  ea1.year_level IS NULL
                  OR CAST(ea1.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                  OR EXISTS (
                    SELECT 1 FROM attendance ay1b
                    WHERE ay1b.event_id = ev.id AND ay1b.student_id = s.id
                  )
                  OR EXISTS (
                    SELECT 1 FROM fines fz1b
                    WHERE fz1b.event_id = ev.id AND fz1b.student_id = s.id
                  )
                )
            )
          ))
          OR EXISTS (
            SELECT 1 FROM event_audiences ea2
            WHERE ea2.event_id = ev.id
              AND (ea2.department_id IS NULL OR ea2.department_id = p.department_id)
              AND (ea2.program_id IS NULL OR ea2.program_id = en.program_id)
              AND (
                ea2.year_level IS NULL
                OR CAST(ea2.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                OR EXISTS (
                  SELECT 1 FROM attendance ay2b
                  WHERE ay2b.event_id = ev.id AND ay2b.student_id = s.id
                )
                OR EXISTS (
                  SELECT 1 FROM fines fz2b
                  WHERE fz2b.event_id = ev.id AND fz2b.student_id = s.id
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM event_audiences ea_mb
            INNER JOIN programs p_ab ON p_ab.id = ea_mb.program_id
            WHERE ea_mb.event_id = ev.id
              AND ea_mb.program_id IS NOT NULL
              AND ea_mb.program_id <> en.program_id
              AND UPPER(TRIM(p_ab.course_code)) = UPPER(TRIM(p.course_code))
              AND LOWER(TRIM(COALESCE(p_ab.major, ''))) = LOWER(TRIM(COALESCE(p.major, '')))
              AND (ea_mb.department_id IS NULL OR ea_mb.department_id = p.department_id)
              AND (
                ea_mb.year_level IS NULL
                OR CAST(ea_mb.year_level AS UNSIGNED) = CAST(${SQL_STUDENT_YEAR_LEVEL} AS UNSIGNED)
                OR EXISTS (
                  SELECT 1 FROM attendance ay3b
                  WHERE ay3b.event_id = ev.id AND ay3b.student_id = s.id
                )
                OR EXISTS (
                  SELECT 1 FROM fines fz3b
                  WHERE fz3b.event_id = ev.id AND fz3b.student_id = s.id
                )
              )
          )
        )
        AND att.id IS NOT NULL
        AND (att.am_time_in IS NOT NULL OR att.pm_time_in IS NOT NULL)
        THEN ev.id
      END) AS events_attended
    FROM students s
    ${enrollmentJoin}
    LEFT JOIN programs p ON p.id = en.program_id
    LEFT JOIN departments d ON d.id = p.department_id
    LEFT JOIN events ev ON ev.status = 'Completed'
      AND ev.academic_period_id = ?
      ${eventCreatorClause}
    LEFT JOIN attendance att ON att.event_id = ev.id AND att.student_id = s.id
    WHERE ${deptClause}
    GROUP BY s.id, s.student_id, s.full_name, s.first_name, s.middle_name, s.last_name, s.year_level, p.course_code, p.major, p.department_id, d.name, en.id, en.year_level
    ORDER BY full_name ASC
    `,
    params,
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
  createdByUserId: number | null = null,
): Promise<EventHistoryDbRow[]> {
  const activePeriod = await getActiveAcademicPeriod();
  const academicPeriodId = activePeriod?.id ?? null;
  if (academicPeriodId == null) return [];

  const creatorClause =
    createdByUserId != null ? " AND ev.created_by = ? " : "";

  const params: (string | number | null)[] = [studentPk, studentPk];
  if (createdByUserId != null) params.push(createdByUserId);
  params.push(
    academicPeriodId,
    enrollmentYearLevel,
    studentPk,
    studentPk,
    enrollmentProgramId,
    enrollmentYearLevel,
    studentPk,
    studentPk,
    enrollmentProgramId,
    enrollmentYearLevel,
    studentPk,
    studentPk,
  );

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
      ${creatorClause}
      AND ev.academic_period_id = ?
      AND (
        (ev.is_all_departments = 1 AND (
          NOT EXISTS (
            SELECT 1 FROM event_audiences ea0
            WHERE ea0.event_id = ev.id AND ea0.year_level IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM event_audiences ea1
            WHERE ea1.event_id = ev.id
              AND (
                ea1.year_level IS NULL
                OR CAST(ea1.year_level AS UNSIGNED) = CAST(? AS UNSIGNED)
                OR EXISTS (
                  SELECT 1 FROM attendance ay_inst
                  WHERE ay_inst.event_id = ev.id AND ay_inst.student_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM fines fz_inst
                  WHERE fz_inst.event_id = ev.id AND fz_inst.student_id = ?
                )
              )
          )
        ))
        OR EXISTS (
          SELECT 1
          FROM event_audiences ea2
          INNER JOIN programs p_student ON p_student.id = ?
          WHERE ea2.event_id = ev.id
            AND (ea2.department_id IS NULL OR ea2.department_id = p_student.department_id)
            AND (ea2.program_id IS NULL OR ea2.program_id = p_student.id)
            AND (
              ea2.year_level IS NULL
              OR CAST(ea2.year_level AS UNSIGNED) = CAST(? AS UNSIGNED)
              OR EXISTS (
                SELECT 1 FROM attendance ay_dep
                WHERE ay_dep.event_id = ev.id AND ay_dep.student_id = ?
              )
              OR EXISTS (
                SELECT 1 FROM fines fz_dep
                WHERE fz_dep.event_id = ev.id AND fz_dep.student_id = ?
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM event_audiences ea_m
          INNER JOIN programs p_aud ON p_aud.id = ea_m.program_id
          INNER JOIN programs p_en ON p_en.id = ?
          WHERE ea_m.event_id = ev.id
            AND ea_m.program_id IS NOT NULL
            AND ea_m.program_id <> p_en.id
            AND UPPER(TRIM(p_aud.course_code)) = UPPER(TRIM(p_en.course_code))
            AND LOWER(TRIM(COALESCE(p_aud.major, ''))) = LOWER(TRIM(COALESCE(p_en.major, '')))
            AND (ea_m.department_id IS NULL OR ea_m.department_id = p_en.department_id)
            AND (
              ea_m.year_level IS NULL
              OR CAST(ea_m.year_level AS UNSIGNED) = CAST(? AS UNSIGNED)
              OR EXISTS (
                SELECT 1 FROM attendance ay_maj
                WHERE ay_maj.event_id = ev.id AND ay_maj.student_id = ?
              )
              OR EXISTS (
                SELECT 1 FROM fines fz_maj
                WHERE fz_maj.event_id = ev.id AND fz_maj.student_id = ?
              )
            )
        )
      )
    ORDER BY ev.date DESC, ev.id DESC
    `,
    params,
  );
  return rows;
}

export async function findStudentEnrollmentContext(studentPk: number): Promise<{
  program_id: number;
  year_level: number;
  course_code: string;
  major: string | null;
  full_name: string;
  department_name: string | null;
} | null> {
  const activePeriod = await getActiveAcademicPeriod();
  const academicPeriodId = activePeriod?.id ?? null;
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(academicPeriodId);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      en.program_id,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
      p.course_code,
      p.major,
      d.name AS department_name,
      ${SQL_STUDENT_FULL_NAME} AS full_name
    FROM students s
    ${enrollmentJoin}
    LEFT JOIN programs p ON p.id = en.program_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE s.id = ?
      AND en.id IS NOT NULL
    LIMIT 1
    `,
    [studentPk],
  );
  const r = rows[0];
  if (!r) return null;
  const yearLevel = Number(r.year_level);
  return {
    program_id: r.program_id != null ? Number(r.program_id) : 0,
    year_level: Number.isFinite(yearLevel) ? yearLevel : 0,
    course_code: r.course_code != null ? String(r.course_code) : "",
    major: r.major == null ? null : String(r.major),
    full_name: String(r.full_name || "").trim(),
    department_name: r.department_name == null ? null : String(r.department_name).trim() || null,
  };
}

export async function resolveStudentPkByPublicId(publicStudentId: string): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM students WHERE student_id = ? LIMIT 1`,
    [publicStudentId],
  );
  return rows[0] ? Number((rows[0] as { id: number }).id) : null;
}
