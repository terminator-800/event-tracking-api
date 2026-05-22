/** Display name: prefer imported full_name, else split name fields. */
export const SQL_STUDENT_FULL_NAME = `COALESCE(NULLIF(TRIM(s.full_name), ''), TRIM(CONCAT_WS(' ', s.first_name, NULLIF(TRIM(s.middle_name), ''), s.last_name)))`;

/** Year level: prefer enrollment, else student record from CSV import. */
export const SQL_STUDENT_YEAR_LEVEL = `COALESCE(en.year_level, s.year_level)`;
