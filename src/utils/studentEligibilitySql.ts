import { SQL_STUDENT_YEAR_LEVEL } from "./studentDisplaySql";

/** Latest enrollment per student (optional — CSV import may have none). */
export const SQL_LATEST_ENROLLMENT_LEFT_JOIN = `LEFT JOIN enrollments en ON en.id = (
  SELECT e2.id FROM enrollments e2 WHERE e2.student_id = s.id ORDER BY e2.id DESC LIMIT 1
)`;

export const SQL_LATEST_PROGRAM_LEFT_JOIN = `LEFT JOIN programs p ON p.id = en.program_id`;

/**
 * Student matches event_audiences: enrolled students via program/dept;
 * CSV-only students when audience rows are institution-wide (NULL dept/program).
 */
export const sqlStudentMatchesEventAudiences = (eventIdParam: string): string => `(
  en.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_audiences ea
    WHERE ea.event_id = ${eventIdParam}
      AND (ea.department_id IS NULL OR ea.department_id = p.department_id)
      AND (ea.program_id IS NULL OR ea.program_id = en.program_id)
      AND (ea.year_level IS NULL OR ea.year_level = ${SQL_STUDENT_YEAR_LEVEL})
  )
  OR (
    en.id IS NULL AND EXISTS (
      SELECT 1 FROM event_audiences ea2
      WHERE ea2.event_id = ${eventIdParam}
        AND ea2.program_id IS NULL
        AND ea2.department_id IS NULL
        AND (ea2.year_level IS NULL OR ea2.year_level = s.year_level)
    )
  )
)`;

export type EligibleStudentsQuery = { sql: string; params: (string | number)[] };

/** DISTINCT student PKs eligible for fines / attendance totals. */
export function buildEligibleStudentsQuery(
  eventId: number,
  isAllDepartments: boolean,
  audienceYearLevel: number | null,
): EligibleStudentsQuery {
  const base = `SELECT DISTINCT s.id AS student_id
    FROM students s
    ${SQL_LATEST_ENROLLMENT_LEFT_JOIN}
    ${SQL_LATEST_PROGRAM_LEFT_JOIN}`;

  if (isAllDepartments) {
    if (audienceYearLevel != null) {
      return {
        sql: `${base} WHERE ${SQL_STUDENT_YEAR_LEVEL} = ?`,
        params: [audienceYearLevel],
      };
    }
    return { sql: base, params: [] };
  }

  return {
    sql: `${base} WHERE ${sqlStudentMatchesEventAudiences("?")}`,
    params: [eventId, eventId],
  };
}
