import type { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { getActiveAcademicPeriod } from "./academic-periods.repository";
import {
  findCompletedEventsForStudent,
  findStudentEnrollmentContext,
  type EventHistoryDbRow,
} from "./student-dashboard.repository";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL } from "../utils/studentDisplaySql";
import { sqlLatestEnrollmentLeftJoin } from "../utils/studentEligibilitySql";

export type PublicStudentAttendanceRow = EventHistoryDbRow & {
  status: string;
  fine_paid_php?: string | null;
  fine_waived_php?: string | null;
};

export type PublicStudentProfile = {
  student_id: string;
  full_name: string;
  year_level: number | null;
  department_name: string | null;
  course_code: string | null;
};

export async function resolveStudentByIdentifier(
  identifier: string,
): Promise<{ pk: number; student_id: string } | null> {
  const value = String(identifier ?? "").trim();
  if (!value) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, student_id
     FROM students
     WHERE student_id = ? OR rfid = ?
     LIMIT 1`,
    [value, value],
  );
  if (!rows.length) return null;
  return {
    pk: Number(rows[0].id),
    student_id: String(rows[0].student_id ?? "").trim(),
  };
}

export async function findPublicStudentProfile(studentPk: number): Promise<PublicStudentProfile | null> {
  const activePeriod = await getActiveAcademicPeriod();
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(activePeriod?.id ?? null);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      s.student_id,
      ${SQL_STUDENT_FULL_NAME} AS full_name,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
      d.name AS department_name,
      p.course_code
    FROM students s
    ${enrollmentJoin}
    LEFT JOIN programs p ON p.id = en.program_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE s.id = ?
    LIMIT 1
    `,
    [studentPk],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const yl = Number(r.year_level);
  return {
    student_id: String(r.student_id ?? "").trim(),
    full_name: String(r.full_name ?? "").trim(),
    year_level: Number.isFinite(yl) ? yl : null,
    department_name: r.department_name != null ? String(r.department_name).trim() || null : null,
    course_code: r.course_code != null ? String(r.course_code).trim() || null : null,
  };
}

/** Fallback when enrollment context is missing: events with attendance or fines. */
export async function findAttendanceHistoryByRecords(
  studentPk: number,
): Promise<PublicStudentAttendanceRow[]> {
  const [rows] = await pool.execute<PublicStudentAttendanceRow[]>(
    `
    SELECT
      ev.id AS event_id,
      ev.name AS name,
      DATE_FORMAT(ev.date, '%Y-%m-%d') AS date,
      ev.duration AS duration,
      ev.status AS status,
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
      ) AS fine_php,
      (
        SELECT COALESCE(SUM(f.paid_amount), 0)
        FROM fines f
        WHERE f.student_id = ? AND f.event_id = ev.id
      ) AS fine_paid_php,
      (
        SELECT COALESCE(SUM(CASE WHEN f.status = 'Waived' THEN GREATEST(f.amount - f.paid_amount, 0) ELSE 0 END), 0)
        FROM fines f
        WHERE f.student_id = ? AND f.event_id = ev.id
      ) AS fine_waived_php
    FROM events ev
    LEFT JOIN attendance att ON att.event_id = ev.id AND att.student_id = ?
    WHERE EXISTS (
      SELECT 1 FROM attendance a2 WHERE a2.event_id = ev.id AND a2.student_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM fines f2 WHERE f2.event_id = ev.id AND f2.student_id = ?
    )
    ORDER BY ev.date DESC, ev.id DESC
    `,
    [studentPk, studentPk, studentPk, studentPk, studentPk, studentPk],
  );
  return rows;
}

export async function findPublicAttendanceHistory(
  studentPk: number,
): Promise<PublicStudentAttendanceRow[]> {
  const ctx = await findStudentEnrollmentContext(studentPk);
  if (ctx && ctx.program_id > 0) {
    const completed = await findCompletedEventsForStudent(
      studentPk,
      ctx.program_id,
      ctx.year_level,
      null,
    );
    return completed.map((row) => ({
      ...row,
      status: "Completed",
    }));
  }
  return findAttendanceHistoryByRecords(studentPk);
}
