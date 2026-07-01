import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";
import {
  DEPARTMENTS_CSV_DEPARTMENT_HEADERS,
  deriveDepartmentCode,
  isDepartmentExcludedFromImport,
  normalizeDepartmentLookupKey,
  resolveDepartmentNameForImport,
} from "../../models/departments.model";
import {
  ENROLLMENTS_CSV_SCHOOL_YEAR_HEADERS,
  ENROLLMENTS_CSV_SEMESTER_HEADERS,
} from "../../models/enrollments.model";
import {
  STUDENTS_CSV_FIRST_NAME_HEADERS,
  STUDENTS_CSV_FULL_NAME_HEADERS,
  STUDENTS_CSV_LAST_NAME_HEADERS,
  STUDENTS_CSV_MIDDLE_NAME_HEADERS,
  STUDENTS_CSV_RFID_HEADERS,
  STUDENTS_CSV_STUDENT_NUMBER_HEADERS,
  STUDENTS_CSV_YEAR_LEVEL_HEADERS,
} from "../../models/students.models";
import { getActiveAcademicPeriod } from "./academic-period.service";
import { normalizeSchoolYear } from "../../utils/academicPeriod";
import type { AcademicPeriodRow } from "../../repositories/queries/academic-periods.queries";

type ImportCounts = {
  departments: number;
  programs: number;
  students: number;
  enrollments: number;
};

export type ImportStudentsCsvResult = {
  processedRows: number;
  importedRows: number;
  skippedRows: number;
  errors: Array<{ row: number; message: string }>;
  skipped: Array<{ row: number; reason: string }>;
  existingStudents: Array<{
    row: number;
    studentId: string;
    fullName: string;
    rfid: string | null;
    yearLevel: number | null;
    yearLevelLabel: string | null;
    departments: string;
    majors: string;
  }>;
  inserted: ImportCounts;
};

type CsvRow = {
  studentId: string;
  rfid: string | null;
  fullName: string | null;
  yearLevel: number | null;
  firstName: string;
  middleName: string;
  lastName: string;
  schoolYear: string;
  semester: string;
  courseCode: string;
  courseName: string;
  major: string | null;
  departmentName: string;
  departmentCode: string;
  hasEnrollmentFields: boolean;
  hasDepartmentOnly: boolean;
};

/** Placeholder enrollment when CSV has department but no course/school year. */
const DEPARTMENT_ONLY_SCHOOL_YEAR = "IMPORT";
const PLACEHOLDER_COURSE_CODE = "UNDECLARED";
const PLACEHOLDER_COURSE_NAME = "Unspecified Program";

const YEAR_LEVEL_BY_LABEL: Record<string, number> = {
  "first year": 1,
  "second year": 2,
  "third year": 3,
  "fourth year": 4,
};

const YEAR_LEVEL_LABEL_BY_NUMBER: Record<number, string> = {
  1: "First Year",
  2: "Second Year",
  3: "Third Year",
  4: "Fourth Year",
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function pickByHeaders(
  rawValues: string[],
  indexByHeader: Map<string, number>,
  headerNames: readonly string[],
): string {
  for (const name of headerNames) {
    const value = rawValues[indexByHeader.get(name) ?? -1]?.trim() ?? "";
    if (value) return value;
  }
  return "";
}

function resolveStudentIdHeader(indexByHeader: Map<string, number>): string | null {
  for (const name of STUDENTS_CSV_STUDENT_NUMBER_HEADERS) {
    if (indexByHeader.has(name)) return name;
  }
  return null;
}

function resolveLevelHeader(indexByHeader: Map<string, number>): string | null {
  for (const name of STUDENTS_CSV_YEAR_LEVEL_HEADERS) {
    if (indexByHeader.has(name)) return name;
  }
  return null;
}

function isRowEmpty(values: string[]): boolean {
  return values.every((value) => !String(value || "").trim());
}

function resolvePositionalPick(
  rawValues: string[],
  indexByHeader: Map<string, number>,
  headerName: string,
  position: number,
): string {
  if (indexByHeader.has(headerName)) {
    return rawValues[indexByHeader.get(headerName) ?? -1]?.trim() ?? "";
  }
  return rawValues[position]?.trim() ?? "";
}

function parseYearLevel(raw: string): number | null {
  const normalized = raw.trim().toLowerCase();
  if (YEAR_LEVEL_BY_LABEL[normalized]) return YEAR_LEVEL_BY_LABEL[normalized];
  const ordinalMatch = normalized.match(/^(\d)(?:st|nd|rd|th)\s*year$/);
  if (ordinalMatch) {
    const level = Number(ordinalMatch[1]);
    if (level >= 1 && level <= 4) return level;
  }
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) return numeric;
  return null;
}

function deriveCourseCode(courseRaw: string): string {
  const cleaned = courseRaw.trim();
  if (!cleaned) return "";
  const upper = cleaned.toUpperCase();
  if (upper.startsWith("BSED")) return "BSED";
  if (upper.startsWith("BEED")) return "BEED";
  if (upper.startsWith("BSIT")) return "BSIT";
  if (upper.startsWith("BSCRIM")) return "BSCRIM";
  if (upper.startsWith("BSHM")) return "BSHM";
  if (upper.startsWith("BSBA")) return "BSBA";
  return upper;
}

function deriveCourseName(courseCode: string, major: string | null): string {
  if (courseCode === "BSED") {
    return major ? `Bachelor of Secondary Education Major in ${major}` : "Bachelor of Secondary Education";
  }
  if (courseCode === "BEED") {
    return major ? `Bachelor of Elementary Education Major in ${major}` : "Bachelor of Elementary Education";
  }
  if (courseCode === "BSIT") return "Bachelor of Science in Information Technology";
  if (courseCode === "BSCRIM") return "Bachelor of Science in Criminology";
  if (courseCode === "BSHM") return "Bachelor of Science in Hospitality Management";
  if (courseCode === "BSBA") return major ? `BSBA ${major}` : "BSBA";
  return courseCode;
}

function normalizeSemester(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered.includes("2nd sem")) return "2nd sem";
  if (lowered.includes("1st sem")) return "1st sem";
  if (lowered.includes("summer")) return "summer";
  return "2nd sem";
}

function buildDisplayName(row: CsvRow): string {
  if (row.fullName?.trim()) return row.fullName.trim();
  const fromParts = [row.firstName, row.middleName, row.lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return fromParts || row.studentId;
}

function parseFlexibleRow(
  rawValues: string[],
  indexByHeader: Map<string, number>,
  rowNumber: number,
  usePositional: boolean,
): CsvRow | null {
  if (isRowEmpty(rawValues)) return null;

  const pick = (headerNames: readonly string[]): string =>
    pickByHeaders(rawValues, indexByHeader, headerNames);
  const studentIdHeader = resolveStudentIdHeader(indexByHeader);
  const levelHeader = resolveLevelHeader(indexByHeader);

  const studentId = usePositional
    ? resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_STUDENT_NUMBER_HEADERS[0], 0) ||
      resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_STUDENT_NUMBER_HEADERS[1], 0)
    : studentIdHeader
      ? rawValues[indexByHeader.get(studentIdHeader) ?? -1]?.trim() ?? ""
      : pick(STUDENTS_CSV_STUDENT_NUMBER_HEADERS);
  const rfidRaw = usePositional
    ? resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_RFID_HEADERS[0], 1)
    : pick(STUDENTS_CSV_RFID_HEADERS);
  const fullNameRaw = usePositional
    ? resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_FULL_NAME_HEADERS[0], 2)
    : pick(STUDENTS_CSV_FULL_NAME_HEADERS);
  const levelRaw = usePositional
    ? resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_YEAR_LEVEL_HEADERS[0], 3) ||
      resolvePositionalPick(rawValues, indexByHeader, STUDENTS_CSV_YEAR_LEVEL_HEADERS[1], 3)
    : levelHeader
      ? rawValues[indexByHeader.get(levelHeader) ?? -1]?.trim() ?? ""
      : pick(STUDENTS_CSV_YEAR_LEVEL_HEADERS);
  const firstName = pick(STUDENTS_CSV_FIRST_NAME_HEADERS);
  const middleName = pick(STUDENTS_CSV_MIDDLE_NAME_HEADERS);
  const lastName = pick(STUDENTS_CSV_LAST_NAME_HEADERS);
  const schoolYear = pick(ENROLLMENTS_CSV_SCHOOL_YEAR_HEADERS);
  const semesterRaw = pick(ENROLLMENTS_CSV_SEMESTER_HEADERS);
  const courseRaw = pick(["course", "course code", "program", "program name"]);
  const majorRaw = pick(["major", "course major", "specialization"]);
  const departmentNameRaw = pick(DEPARTMENTS_CSV_DEPARTMENT_HEADERS);
  const departmentName = departmentNameRaw ? resolveDepartmentNameForImport(departmentNameRaw) : "";

  const resolvedStudentId = studentId || (rfidRaw ? `RFID-${rfidRaw}` : `IMPORT-${rowNumber}`);
  const resolvedFullName =
    fullNameRaw ||
    [firstName, middleName, lastName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ") ||
    null;

  const yearLevel = levelRaw ? parseYearLevel(levelRaw) : null;
  const courseCode = courseRaw ? deriveCourseCode(courseRaw) : "";
  const major = majorRaw ? majorRaw : null;
  const hasEnrollmentFields = Boolean(departmentName && courseRaw && schoolYear && courseCode);
  const hasDepartmentOnly = Boolean(departmentName && !hasEnrollmentFields);

  return {
    studentId: resolvedStudentId,
    rfid: rfidRaw ? rfidRaw : null,
    fullName: resolvedFullName,
    yearLevel,
    firstName,
    middleName,
    lastName,
    schoolYear,
    semester: semesterRaw ? normalizeSemester(semesterRaw) : "2nd sem",
    courseCode,
    courseName: courseCode ? deriveCourseName(courseCode, major) : "",
    major,
    departmentName,
    departmentCode: departmentName ? deriveDepartmentCode(departmentName) : "",
    hasEnrollmentFields,
    hasDepartmentOnly,
  };
}

function parseRows(csvText: string): { rows: CsvRow[]; errors: Array<{ row: number; message: string }> } {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return { rows: [], errors: [{ row: 1, message: "CSV has no data rows." }] };
  }

  const headerValues = parseCsvLine(lines[0]).map(normalizeHeaderName);
  const indexByHeader = new Map<string, number>();
  headerValues.forEach((h, idx) => indexByHeader.set(h, idx));

  const usePositional = !resolveStudentIdHeader(indexByHeader) && headerValues.length <= 4;

  const rows: CsvRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const rawValues = parseCsvLine(lines[i]);
    const rowNumber = i + 1;
    const parsed = parseFlexibleRow(rawValues, indexByHeader, rowNumber, usePositional);
    if (parsed) rows.push(parsed);
  }

  return { rows, errors };
}

async function getOrCreateDepartment(connection: PoolConnection, row: CsvRow): Promise<{ id: number; inserted: boolean }> {
  const normalizedName = normalizeDepartmentLookupKey(row.departmentName);

  const [byCode] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM departments WHERE code = ? LIMIT 1",
    [row.departmentCode],
  );
  if (byCode.length > 0) return { id: Number(byCode[0].id), inserted: false };

  const [byName] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM departments WHERE LOWER(TRIM(name)) = ? LIMIT 1",
    [normalizedName],
  );
  if (byName.length > 0) return { id: Number(byName[0].id), inserted: false };

  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO departments (name, code) VALUES (?, ?)",
    [row.departmentName, row.departmentCode],
  );
  return { id: Number(created.insertId), inserted: true };
}

async function getOrCreateProgram(
  connection: PoolConnection,
  row: CsvRow,
  departmentId: number,
): Promise<{ id: number; inserted: boolean }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM programs WHERE course_code = ? AND course_name = ? AND COALESCE(major, '') = COALESCE(?, '') AND department_id = ? LIMIT 1",
    [row.courseCode, row.courseName, row.major, departmentId],
  );
  if (existing.length > 0) return { id: Number(existing[0].id), inserted: false };

  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO programs (course_code, course_name, major, department_id) VALUES (?, ?, ?, ?)",
    [row.courseCode, row.courseName, row.major, departmentId],
  );
  return { id: Number(created.insertId), inserted: true };
}

async function getOrCreatePlaceholderProgram(
  connection: PoolConnection,
  departmentId: number,
): Promise<{ id: number; inserted: boolean }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM programs WHERE course_code = ? AND course_name = ? AND department_id = ? LIMIT 1",
    [PLACEHOLDER_COURSE_CODE, PLACEHOLDER_COURSE_NAME, departmentId],
  );
  if (existing.length > 0) return { id: Number(existing[0].id), inserted: false };

  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO programs (course_code, course_name, major, department_id) VALUES (?, ?, NULL, ?)",
    [PLACEHOLDER_COURSE_CODE, PLACEHOLDER_COURSE_NAME, departmentId],
  );
  return { id: Number(created.insertId), inserted: true };
}

async function upsertStudent(
  connection: PoolConnection,
  row: CsvRow,
): Promise<{ id: number; inserted: boolean }> {
  const [existingByStudentId] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM students WHERE student_id = ? LIMIT 1",
    [row.studentId],
  );

  const applyUpdate = async (studentPk: number): Promise<void> => {
    await connection.execute(
      `UPDATE students SET
        rfid = COALESCE(?, rfid),
        full_name = COALESCE(?, full_name),
        year_level = COALESCE(?, year_level),
        first_name = COALESCE(?, first_name),
        middle_name = COALESCE(?, middle_name),
        last_name = COALESCE(?, last_name)
      WHERE id = ?`,
      [
        row.rfid,
        row.fullName,
        row.yearLevel,
        row.firstName || null,
        row.middleName || null,
        row.lastName || null,
        studentPk,
      ],
    );
  };

  if (existingByStudentId.length > 0) {
    const studentPk = Number(existingByStudentId[0].id);
    try {
      await applyUpdate(studentPk);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.toLowerCase().includes("rfid")) throw error;
      await connection.execute(
        `UPDATE students SET
          full_name = COALESCE(?, full_name),
          year_level = COALESCE(?, year_level),
          first_name = COALESCE(?, first_name),
          middle_name = COALESCE(?, middle_name),
          last_name = COALESCE(?, last_name)
        WHERE id = ?`,
        [
          row.fullName,
          row.yearLevel,
          row.firstName || null,
          row.middleName || null,
          row.lastName || null,
          studentPk,
        ],
      );
    }
    return { id: studentPk, inserted: false };
  }

  try {
    const [created] = await connection.execute<ResultSetHeader>(
      `INSERT INTO students (
        student_id, rfid, full_name, year_level, first_name, middle_name, last_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.studentId,
        row.rfid,
        row.fullName,
        row.yearLevel,
        row.firstName || null,
        row.middleName || null,
        row.lastName || null,
      ],
    );
    return { id: Number(created.insertId), inserted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.toLowerCase().includes("rfid") || !row.rfid) throw error;

    const [created] = await connection.execute<ResultSetHeader>(
      `INSERT INTO students (
        student_id, rfid, full_name, year_level, first_name, middle_name, last_name
      ) VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [
        row.studentId,
        row.fullName,
        row.yearLevel,
        row.firstName || null,
        row.middleName || null,
        row.lastName || null,
      ],
    );
    return { id: Number(created.insertId), inserted: true };
  }
}

async function upsertEnrollment(
  connection: PoolConnection,
  row: CsvRow,
  studentId: number,
  programId: number,
  schoolYear: string,
  academicPeriodId: number | null,
  effectiveSemester: string,
): Promise<"inserted" | "updated"> {
  const [existingKey] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM enrollments WHERE student_id = ? AND program_id = ? AND school_year = ? AND semester = ? LIMIT 1",
    [studentId, programId, schoolYear, effectiveSemester],
  );

  if (existingKey.length > 0) {
    if (row.yearLevel != null || academicPeriodId != null) {
      await connection.execute(
        "UPDATE enrollments SET year_level = COALESCE(?, year_level), academic_period_id = COALESCE(?, academic_period_id) WHERE id = ?",
        [row.yearLevel, academicPeriodId, Number(existingKey[0].id)],
      );
    }
    return "updated";
  }

  await connection.execute(
    "INSERT INTO enrollments (student_id, program_id, academic_period_id, school_year, semester, year_level) VALUES (?, ?, ?, ?, ?, ?)",
    [studentId, programId, academicPeriodId, schoolYear, effectiveSemester, row.yearLevel],
  );
  return "inserted";
}

async function linkStudentDepartment(
  connection: PoolConnection,
  row: CsvRow,
  studentPk: number,
  inserted: ImportCounts,
  activePeriod: AcademicPeriodRow | null,
): Promise<void> {
  if (!row.hasEnrollmentFields && !row.hasDepartmentOnly) return;

  const dept = await getOrCreateDepartment(connection, row);
  if (dept.inserted) inserted.departments += 1;

  const program = row.hasEnrollmentFields
    ? await getOrCreateProgram(connection, row, dept.id)
    : await getOrCreatePlaceholderProgram(connection, dept.id);
  if (program.inserted) inserted.programs += 1;

  let schoolYear = row.schoolYear?.trim() || DEPARTMENT_ONLY_SCHOOL_YEAR;
  let semester = row.semester;
  const academicPeriodId = activePeriod?.id ?? null;

  if (activePeriod) {
    if (row.hasEnrollmentFields && row.schoolYear?.trim()) {
      const csvSchoolYear = normalizeSchoolYear(row.schoolYear);
      if (csvSchoolYear && csvSchoolYear !== activePeriod.school_year) {
        throw new Error(
          `School year "${row.schoolYear}" does not match the active period (${activePeriod.school_year}).`,
        );
      }
    }
    if (row.hasEnrollmentFields && row.semester?.trim()) {
      const csvSemester = normalizeSemester(row.semester);
      if (csvSemester && csvSemester !== activePeriod.semester) {
        throw new Error(
          `Semester "${row.semester}" does not match the active period (${activePeriod.semester}).`,
        );
      }
    }
    schoolYear = activePeriod.school_year;
    semester = activePeriod.semester;
  }

  const enrollmentState = await upsertEnrollment(
    connection,
    row,
    studentPk,
    program.id,
    schoolYear,
    academicPeriodId,
    semester,
  );
  if (enrollmentState === "inserted") inserted.enrollments += 1;
}

async function getStudentDepartmentMajorSummary(
  connection: PoolConnection,
  studentPk: number,
): Promise<{ departments: string; majors: string }> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(GROUP_CONCAT(DISTINCT d.name ORDER BY d.name SEPARATOR ', '), '') AS departments,
      COALESCE(
        GROUP_CONCAT(
          DISTINCT NULLIF(TRIM(p.major), '')
          ORDER BY NULLIF(TRIM(p.major), '')
          SEPARATOR ', '
        ),
        ''
      ) AS majors
    FROM enrollments e
    INNER JOIN programs p ON p.id = e.program_id
    INNER JOIN departments d ON d.id = p.department_id
    WHERE e.student_id = ?`,
    [studentPk],
  );

  if (!rows.length) {
    return { departments: "No enrollment record yet", majors: "No major" };
  }

  const departments = String(rows[0].departments || "").trim() || "No enrollment record yet";
  const majors = String(rows[0].majors || "").trim() || "No major";
  return { departments, majors };
}

export async function importStudentsCsv(fileBuffer: Buffer): Promise<ImportStudentsCsvResult> {
  const activePeriod = await getActiveAcademicPeriod();
  if (!activePeriod) {
    throw new Error("No active school year and semester. Activate an academic period before importing students.");
  }

  const csvText = fileBuffer.toString("utf-8");
  const { rows, errors } = parseRows(csvText);
  const skipped: Array<{ row: number; reason: string }> = [];
  const existingStudents: Array<{
    row: number;
    studentId: string;
    fullName: string;
    rfid: string | null;
    yearLevel: number | null;
    yearLevelLabel: string | null;
    departments: string;
    majors: string;
  }> = [];

  const inserted: ImportCounts = {
    departments: 0,
    programs: 0,
    students: 0,
    enrollments: 0,
  };

  const connection = await pool.getConnection();
  let importedRows = 0;
  let skippedRows = 0;

  try {
    await connection.beginTransaction();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const lineNumber = index + 2;

      if (isDepartmentExcludedFromImport(row.departmentName)) {
        skippedRows += 1;
        skipped.push({
          row: lineNumber,
          reason: "Graduate School students are excluded from import.",
        });
        continue;
      }

      try {
        const student = await upsertStudent(connection, row);
        if (student.inserted) inserted.students += 1;
        else {
          const summary = await getStudentDepartmentMajorSummary(connection, student.id);
          existingStudents.push({
            row: lineNumber,
            studentId: row.studentId,
            fullName: buildDisplayName(row),
            rfid: row.rfid,
            yearLevel: row.yearLevel,
            yearLevelLabel: row.yearLevel != null ? YEAR_LEVEL_LABEL_BY_NUMBER[row.yearLevel] ?? null : null,
            departments: summary.departments,
            majors: summary.majors,
          });
        }

        await linkStudentDepartment(connection, row, student.id, inserted, activePeriod);

        importedRows += 1;
      } catch (rowError) {
        skippedRows += 1;
        const message = rowError instanceof Error ? rowError.message : "Unknown row processing error.";
        errors.push({ row: lineNumber, message });
        skipped.push({ row: lineNumber, reason: message });
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    processedRows: rows.length,
    importedRows,
    skippedRows,
    errors,
    skipped,
    existingStudents,
    inserted,
  };
}
