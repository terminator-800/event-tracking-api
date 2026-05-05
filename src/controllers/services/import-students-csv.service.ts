import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../../config/db";

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
    departments: string;
    majors: string;
  }>;
  inserted: ImportCounts;
};

type CsvRow = {
  studentId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  schoolYear: string;
  semester: string;
  courseCode: string;
  courseName: string;
  major: string | null;
  yearLevel: number;
  departmentName: string;
  departmentCode: string;
};

const DEPARTMENT_CODE_BY_NAME: Record<string, string> = {
  "college of information technology": "CIT",
  "college of business administration": "CBA",
  "college of education, arts and sciences": "CEAS",
  "college of teacher education": "CEAS",
  "college of criminology": "CCJE",
  "college of criminal justice education": "CCJE",
  "college of hospitality management": "CHM",
};

const DEPARTMENT_CANONICAL_NAME_BY_NAME: Record<string, string> = {
  "college of teacher education": "College of Education, Arts and Sciences",
  "college of education, arts and sciences": "College of Education, Arts and Sciences",
  "college of criminology": "College of Criminal Justice Education",
  "college of criminal justice education": "College of Criminal Justice Education",
};

const YEAR_LEVEL_BY_LABEL: Record<string, number> = {
  "first year": 1,
  "second year": 2,
  "third year": 3,
  "fourth year": 4,
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
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveStudentIdHeader(indexByHeader: Map<string, number>): string | null {
  if (indexByHeader.has("id number")) return "id number";
  if (indexByHeader.has("student id")) return "student id";
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

function deriveDepartmentCode(departmentName: string): string {
  const normalized = departmentName.trim().toLowerCase();
  if (DEPARTMENT_CODE_BY_NAME[normalized]) return DEPARTMENT_CODE_BY_NAME[normalized];
  const words = departmentName.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "DEPT";
  return words.map((word) => word[0].toUpperCase()).join("").slice(0, 20);
}

function normalizeDepartmentName(departmentName: string): string {
  const normalized = departmentName.trim().toLowerCase();
  if (DEPARTMENT_CANONICAL_NAME_BY_NAME[normalized]) {
    return DEPARTMENT_CANONICAL_NAME_BY_NAME[normalized];
  }
  return departmentName.trim();
}

function normalizeSemester(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered.includes("2nd sem")) return "2nd sem";
  if (lowered.includes("1st sem")) return "1st sem";
  if (lowered.includes("summer")) return "summer";
  return "2nd sem";
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
  const studentIdHeader = resolveStudentIdHeader(indexByHeader);

  const requiredHeaders = [
    "first name",
    "last name",
    "school year",
    "course",
    "year",
    "department",
  ];
  if (!studentIdHeader) {
    requiredHeaders.unshift("id number");
  }

  const missing = requiredHeaders.filter((header) => !indexByHeader.has(header));
  if (missing.length > 0) {
    return { rows: [], errors: [{ row: 1, message: `Missing required headers: ${missing.join(", ")}` }] };
  }

  const rows: CsvRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const rawValues = parseCsvLine(lines[i]);
    const pick = (name: string): string => rawValues[indexByHeader.get(name) ?? -1]?.trim() ?? "";
    const rowNumber = i + 1;

    const studentId = studentIdHeader ? pick(studentIdHeader) : "";
    const firstName = pick("first name");
    const middleName = pick("middle name");
    const lastName = pick("last name");
    const schoolYear = pick("school year");
    const semesterRaw = pick("semester");
    const courseRaw = pick("course");
    const majorRaw = pick("major");
    const yearRaw = pick("year").toLowerCase();
    const departmentNameRaw = pick("department");
    const departmentName = normalizeDepartmentName(departmentNameRaw);

    if (!studentId || !firstName || !lastName || !departmentName || !courseRaw || !schoolYear) {
      errors.push({ row: rowNumber, message: "Missing required value(s)." });
      continue;
    }

    const yearLevel = YEAR_LEVEL_BY_LABEL[yearRaw];
    if (!yearLevel) {
      errors.push({ row: rowNumber, message: `Unsupported year level: ${yearRaw || "(empty)"}` });
      continue;
    }

    const courseCode = deriveCourseCode(courseRaw);
    if (!courseCode) {
      errors.push({ row: rowNumber, message: "Could not derive course code." });
      continue;
    }

    const major = majorRaw ? majorRaw : null;
    rows.push({
      studentId,
      firstName,
      middleName,
      lastName,
      schoolYear,
      semester: normalizeSemester(semesterRaw),
      courseCode,
      courseName: deriveCourseName(courseCode, major),
      major,
      yearLevel,
      departmentName,
      departmentCode: deriveDepartmentCode(departmentName),
    });
  }

  return { rows, errors };
}

async function getOrCreateDepartment(connection: PoolConnection, row: CsvRow): Promise<{ id: number; inserted: boolean }> {
  const [existing] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM departments WHERE name = ? OR code = ? LIMIT 1",
    [row.departmentName, row.departmentCode],
  );
  if (existing.length > 0) return { id: Number(existing[0].id), inserted: false };

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

async function getOrCreateStudent(connection: PoolConnection, row: CsvRow): Promise<{ id: number; inserted: boolean }> {
  const [existingByStudentId] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM students WHERE student_id = ? LIMIT 1",
    [row.studentId],
  );
  if (existingByStudentId.length > 0) return { id: Number(existingByStudentId[0].id), inserted: false };

  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO students (student_id, first_name, middle_name, last_name) VALUES (?, ?, ?, ?)",
    [row.studentId, row.firstName, row.middleName || null, row.lastName],
  );
  return { id: Number(created.insertId), inserted: true };
}

async function createEnrollmentIfMissing(
  connection: PoolConnection,
  row: CsvRow,
  studentId: number,
  programId: number,
): Promise<"inserted" | "exists"> {
  const [existingKey] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM enrollments WHERE student_id = ? AND program_id = ? AND school_year = ? AND semester = ? LIMIT 1",
    [studentId, programId, row.schoolYear, row.semester],
  );
  if (existingKey.length > 0) return "exists";

  await connection.execute(
    "INSERT INTO enrollments (student_id, program_id, school_year, semester, year_level) VALUES (?, ?, ?, ?, ?)",
    [studentId, programId, row.schoolYear, row.semester, row.yearLevel],
  );
  return "inserted";
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
  const csvText = fileBuffer.toString("utf-8");
  const { rows, errors } = parseRows(csvText);
  const skipped: Array<{ row: number; reason: string }> = [];
  const existingStudents: Array<{
    row: number;
    studentId: string;
    fullName: string;
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
      try {
        const dept = await getOrCreateDepartment(connection, row);
        if (dept.inserted) inserted.departments += 1;

        const program = await getOrCreateProgram(connection, row, dept.id);
        if (program.inserted) inserted.programs += 1;

        const student = await getOrCreateStudent(connection, row);
        if (student.inserted) inserted.students += 1;
        if (!student.inserted) {
          const summary = await getStudentDepartmentMajorSummary(connection, student.id);
          const fullName = [row.firstName, row.middleName, row.lastName]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(" ");
          existingStudents.push({
            row: lineNumber,
            studentId: row.studentId,
            fullName,
            departments: summary.departments,
            majors: summary.majors,
          });
        }

        const enrollmentState = await createEnrollmentIfMissing(connection, row, student.id, program.id);
        if (enrollmentState === "inserted") {
          inserted.enrollments += 1;
          importedRows += 1;
        } else {
          skippedRows += 1;
          skipped.push({
            row: lineNumber,
            reason: "Enrollment already exists for this student/program/school year/semester.",
          });
        }
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
