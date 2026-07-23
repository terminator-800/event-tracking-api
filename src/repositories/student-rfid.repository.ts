import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { getActiveAcademicPeriod } from "./academic-periods.repository";
import { SQL_STUDENT_FULL_NAME, SQL_STUDENT_YEAR_LEVEL } from "../utils/studentDisplaySql";
import { sqlLatestEnrollmentLeftJoin } from "../utils/studentEligibilitySql";

export type StudentRfidProfile = {
  id: number;
  studentId: string;
  fullName: string;
  rfid: string | null;
  yearLevel: number | null;
  departmentName: string | null;
  courseCode: string | null;
  major: string | null;
};

function mapProfileRow(r: RowDataPacket): StudentRfidProfile {
  const yl = Number(r.year_level);
  const rfid = r.rfid != null ? String(r.rfid).trim() : "";
  const major = r.major != null ? String(r.major).trim() : "";
  return {
    id: Number(r.id),
    studentId: String(r.student_id ?? "").trim(),
    fullName: String(r.full_name ?? "").trim(),
    rfid: rfid || null,
    yearLevel: Number.isFinite(yl) ? yl : null,
    departmentName: r.department_name != null ? String(r.department_name).trim() || null : null,
    courseCode: r.course_code != null ? String(r.course_code).trim() || null : null,
    major: major || null,
  };
}

async function selectProfiles(
  whereSql: string,
  params: unknown[],
  limit = 1,
): Promise<StudentRfidProfile[]> {
  const activePeriod = await getActiveAcademicPeriod();
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(activePeriod?.id ?? null);
  const take = Math.min(25, Math.max(1, Math.floor(Number(limit) || 1)));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      s.id,
      s.student_id,
      s.rfid,
      ${SQL_STUDENT_FULL_NAME} AS full_name,
      ${SQL_STUDENT_YEAR_LEVEL} AS year_level,
      d.name AS department_name,
      p.course_code,
      p.major
    FROM students s
    ${enrollmentJoin}
    LEFT JOIN programs p ON p.id = en.program_id
    LEFT JOIN departments d ON d.id = p.department_id
    WHERE ${whereSql}
    ORDER BY full_name ASC
    LIMIT ${take}
    `,
    params,
  );
  return rows.map(mapProfileRow);
}

/** Exact match on Student ID or RFID. */
export async function findStudentRfidProfileByIdentifier(
  identifier: string,
): Promise<StudentRfidProfile | null> {
  const value = String(identifier ?? "").trim();
  if (!value) return null;
  const rows = await selectProfiles("s.student_id = ? OR s.rfid = ?", [value, value], 1);
  return rows[0] ?? null;
}

/** Search by Student ID (exact), RFID (exact), or name (partial). */
export async function searchStudentRfidProfiles(
  query: string,
  limit = 15,
): Promise<StudentRfidProfile[]> {
  const value = String(query ?? "").trim();
  if (!value) return [];

  const exact = await findStudentRfidProfileByIdentifier(value);
  if (exact) return [exact];

  if (value.length < 2) return [];

  const like = `%${value.toLowerCase()}%`;
  return selectProfiles(
    `
      LOWER(${SQL_STUDENT_FULL_NAME}) LIKE ?
      OR LOWER(TRIM(COALESCE(s.full_name, ''))) LIKE ?
      OR LOWER(TRIM(COALESCE(s.first_name, ''))) LIKE ?
      OR LOWER(TRIM(COALESCE(s.last_name, ''))) LIKE ?
      OR LOWER(TRIM(COALESCE(s.student_id, ''))) LIKE ?
    `,
    [like, like, like, like, like],
    limit,
  );
}

export async function findStudentRfidProfileByPublicId(
  studentId: string,
): Promise<StudentRfidProfile | null> {
  const value = String(studentId ?? "").trim();
  if (!value) return null;
  const rows = await selectProfiles("s.student_id = ?", [value], 1);
  return rows[0] ?? null;
}

export async function findStudentPkByRfid(rfid: string): Promise<number | null> {
  const value = String(rfid ?? "").trim();
  if (!value) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM students WHERE rfid = ? LIMIT 1`,
    [value],
  );
  if (!rows.length) return null;
  return Number(rows[0].id);
}

export async function updateStudentRfidByPublicId(
  studentId: string,
  rfid: string | null,
): Promise<"ok" | "not_found" | "duplicate"> {
  const publicId = String(studentId ?? "").trim();
  if (!publicId) return "not_found";

  const profile = await findStudentRfidProfileByPublicId(publicId);
  if (!profile) return "not_found";

  const nextRfid = rfid == null || !String(rfid).trim() ? null : String(rfid).trim();
  if (nextRfid) {
    const ownerPk = await findStudentPkByRfid(nextRfid);
    if (ownerPk != null && ownerPk !== profile.id) return "duplicate";
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE students SET rfid = ? WHERE id = ?`,
    [nextRfid, profile.id],
  );
  return result.affectedRows > 0 ? "ok" : "not_found";
}
