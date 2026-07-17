import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../../config/db";
import {
  getAcademicPeriodById,
  getActiveAcademicPeriod,
  listAcademicPeriods,
} from "../../repositories/academic-periods.repository";
import {
  ACADEMIC_PERIOD_QUERIES,
  type AcademicPeriodRow,
} from "../../repositories/queries/academic-periods.queries";
import {
  formatAcademicPeriodLabel,
  normalizeSchoolYear,
  normalizeSemester,
} from "../../utils/academicPeriod";
import type { AcademicPeriodSemester } from "../../models/academic_periods.model";

interface FailResult {
  success: false;
  status: number;
  message: string;
}

interface SuccessResult<T = undefined> {
  success: true;
  status: number;
  data?: T;
}

type ServiceResult<T = undefined> = FailResult | SuccessResult<T>;

export type CreateAcademicPeriodInput = {
  schoolYear: string;
  semester: string;
  label?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  createdByUserId?: number | null;
};

export type UpdateAcademicPeriodInput = {
  schoolYear?: string;
  semester?: string;
  label?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
};

export { getActiveAcademicPeriod, getAcademicPeriodById, listAcademicPeriods };

function parsePeriodInput(
  input: CreateAcademicPeriodInput | UpdateAcademicPeriodInput,
  requireAll: boolean,
): ServiceResult<{ schoolYear: string; semester: AcademicPeriodSemester; label: string | null; startsOn: string | null; endsOn: string | null }> {
  const schoolYear = normalizeSchoolYear(
    "schoolYear" in input ? input.schoolYear : undefined,
  );
  const semester = normalizeSemester("semester" in input ? input.semester : undefined);

  if (requireAll && (!schoolYear || !semester)) {
    return { success: false, status: 400, message: "School year and semester are required." };
  }

  if ("semester" in input && input.semester != null && String(input.semester).trim() && !semester) {
    return { success: false, status: 400, message: "Semester must be 1st sem, 2nd sem, or summer." };
  }

  const labelRaw = "label" in input ? input.label : undefined;
  const label =
    labelRaw != null && String(labelRaw).trim()
      ? String(labelRaw).trim()
      : schoolYear && semester
        ? formatAcademicPeriodLabel(schoolYear, semester)
        : null;

  const startsOn =
    "startsOn" in input && input.startsOn != null && String(input.startsOn).trim()
      ? String(input.startsOn).trim()
      : null;
  const endsOn =
    "endsOn" in input && input.endsOn != null && String(input.endsOn).trim()
      ? String(input.endsOn).trim()
      : null;

  if (!requireAll && !schoolYear && !semester && label === null && startsOn === null && endsOn === null) {
    return { success: false, status: 400, message: "No fields to update." };
  }

  return {
    success: true,
    status: 200,
    data: {
      schoolYear,
      semester: semester as AcademicPeriodSemester,
      label,
      startsOn,
      endsOn,
    },
  };
}

export async function createAcademicPeriod(
  input: CreateAcademicPeriodInput,
): Promise<ServiceResult<{ period: AcademicPeriodRow }>> {
  const parsed = parsePeriodInput(input, true);
  if (!parsed.success) return parsed;
  const { schoolYear, semester, label, startsOn, endsOn } = parsed.data!;

  const [existing] = await pool.execute<RowDataPacket[]>(
    ACADEMIC_PERIOD_QUERIES.findBySchoolYearSemester,
    [schoolYear, semester],
  );
  if (existing.length > 0) {
    return { success: false, status: 409, message: "This school year and semester already exists." };
  }

  const [result] = await pool.execute<ResultSetHeader>(ACADEMIC_PERIOD_QUERIES.insert, [
    schoolYear,
    semester,
    label,
    startsOn,
    endsOn,
    input.createdByUserId ?? null,
  ]);

  const period = await getAcademicPeriodById(result.insertId);
  if (!period) {
    return { success: false, status: 500, message: "Failed to load created academic period." };
  }

  return { success: true, status: 201, data: { period } };
}

/**
 * Creates the standard 1st and 2nd semester rows for one school year atomically.
 * Used by System Settings so a partially-created school year cannot occur.
 */
export async function createAcademicYearPeriods(
  schoolYearInput: string,
  createdByUserId: number | null,
): Promise<ServiceResult<{ periods: AcademicPeriodRow[] }>> {
  const schoolYear = normalizeSchoolYear(schoolYearInput);
  if (!schoolYear) {
    return { success: false, status: 400, message: "School year is required." };
  }

  const semesters: AcademicPeriodSemester[] = ["1st sem", "2nd sem"];
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT semester
       FROM academic_periods
       WHERE school_year = ? AND semester IN ('1st sem', '2nd sem')`,
      [schoolYear],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return {
        success: false,
        status: 409,
        message: "This school year already has a 1st or 2nd semester record.",
      };
    }

    const createdIds: number[] = [];
    for (const semester of semesters) {
      const [result] = await connection.execute<ResultSetHeader>(
        ACADEMIC_PERIOD_QUERIES.insert,
        [
          schoolYear,
          semester,
          formatAcademicPeriodLabel(schoolYear, semester),
          null,
          null,
          createdByUserId,
        ],
      );
      createdIds.push(Number(result.insertId));
    }

    await connection.commit();

    const periods = (
      await Promise.all(createdIds.map((id) => getAcademicPeriodById(id)))
    ).filter((period): period is AcademicPeriodRow => period != null);

    if (periods.length !== semesters.length) {
      return {
        success: false,
        status: 500,
        message: "Academic periods were created but could not be loaded.",
      };
    }

    return { success: true, status: 201, data: { periods } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateAcademicPeriod(
  id: number,
  input: UpdateAcademicPeriodInput,
): Promise<ServiceResult<{ period: AcademicPeriodRow }>> {
  const current = await getAcademicPeriodById(id);
  if (!current) {
    return { success: false, status: 404, message: "Academic period not found." };
  }
  if (current.status !== "draft") {
    return { success: false, status: 400, message: "Only draft academic periods can be edited." };
  }

  const schoolYear = input.schoolYear != null ? normalizeSchoolYear(input.schoolYear) : current.school_year;
  const semester =
    input.semester != null
      ? normalizeSemester(input.semester) || (current.semester as AcademicPeriodSemester)
      : current.semester;
  if (input.semester != null && String(input.semester).trim() && !normalizeSemester(input.semester)) {
    return { success: false, status: 400, message: "Semester must be 1st sem, 2nd sem, or summer." };
  }

  const label =
    input.label !== undefined
      ? input.label != null && String(input.label).trim()
        ? String(input.label).trim()
        : formatAcademicPeriodLabel(schoolYear, semester)
      : current.label;
  const startsOn =
    input.startsOn !== undefined
      ? input.startsOn != null && String(input.startsOn).trim()
        ? String(input.startsOn).trim()
        : null
      : current.starts_on;
  const endsOn =
    input.endsOn !== undefined
      ? input.endsOn != null && String(input.endsOn).trim()
        ? String(input.endsOn).trim()
        : null
      : current.ends_on;

  const [duplicate] = await pool.execute<RowDataPacket[]>(
    ACADEMIC_PERIOD_QUERIES.findBySchoolYearSemester,
    [schoolYear, semester],
  );
  if (duplicate.length > 0 && Number(duplicate[0].id) !== id) {
    return { success: false, status: 409, message: "Another period already uses this school year and semester." };
  }

  const [result] = await pool.execute<ResultSetHeader>(ACADEMIC_PERIOD_QUERIES.updateDraft, [
    schoolYear,
    semester,
    label,
    startsOn,
    endsOn,
    id,
  ]);

  if (result.affectedRows === 0) {
    return { success: false, status: 400, message: "Academic period could not be updated." };
  }

  const period = await getAcademicPeriodById(id);
  return { success: true, status: 200, data: { period: period! } };
}

export async function activateAcademicPeriod(
  id: number,
  activatedByUserId: number,
): Promise<ServiceResult<{ period: AcademicPeriodRow }>> {
  const current = await getAcademicPeriodById(id);
  if (!current) {
    return { success: false, status: 404, message: "Academic period not found." };
  }
  if (current.status === "active") {
    return { success: true, status: 200, data: { period: current } };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(ACADEMIC_PERIOD_QUERIES.archiveAllActive);
    const [result] = await connection.execute<ResultSetHeader>(ACADEMIC_PERIOD_QUERIES.activate, [
      activatedByUserId,
      id,
    ]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return { success: false, status: 400, message: "Academic period could not be activated." };
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const period = await getAcademicPeriodById(id);
  return { success: true, status: 200, data: { period: period! } };
}

export async function deleteAcademicPeriod(id: number): Promise<ServiceResult> {
  const current = await getAcademicPeriodById(id);
  if (!current) {
    return { success: false, status: 404, message: "Academic period not found." };
  }
  if (current.status === "active") {
    return {
      success: false,
      status: 400,
      message:
        "Cannot delete the active academic period. Activate a different period first — the current one will be archived.",
    };
  }

  const [[enrollmentRows], [eventRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(ACADEMIC_PERIOD_QUERIES.countEnrollments, [id]),
    pool.execute<RowDataPacket[]>(ACADEMIC_PERIOD_QUERIES.countEvents, [id]),
  ]);

  const enrollmentCount = Number(enrollmentRows[0]?.cnt ?? 0);
  const eventCount = Number(eventRows[0]?.cnt ?? 0);
  if (enrollmentCount > 0 || eventCount > 0) {
    return {
      success: false,
      status: 400,
      message: `Cannot delete this period — it has ${enrollmentCount} enrollment(s) and ${eventCount} event(s) linked. Remove or reassign that data first.`,
    };
  }

  const [result] = await pool.execute<ResultSetHeader>(ACADEMIC_PERIOD_QUERIES.deleteById, [id]);
  if (result.affectedRows === 0) {
    return { success: false, status: 400, message: "Academic period could not be deleted." };
  }

  return { success: true, status: 200 };
}
