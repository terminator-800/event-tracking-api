/** Display name: prefer imported full_name, else split name fields. */
export const SQL_STUDENT_FULL_NAME = `COALESCE(NULLIF(TRIM(s.full_name), ''), TRIM(CONCAT_WS(' ', s.first_name, NULLIF(TRIM(s.middle_name), ''), s.last_name)))`;

/** Year level: prefer enrollment, else student record from CSV import. */
export const SQL_STUDENT_YEAR_LEVEL = `COALESCE(en.year_level, s.year_level)`;

/**
 * Department name: latest enrollment program, else fined-event audience/creator dept.
 * `d` = departments alias from `LEFT JOIN departments d ON d.id = p.department_id`.
 */
export const SQL_STUDENT_DEPARTMENT_NAME = `COALESCE(
  NULLIF(TRIM(d.name), ''),
  (
    SELECT dep.name
    FROM enrollments en_dep
    INNER JOIN programs p_dep ON p_dep.id = en_dep.program_id
    INNER JOIN departments dep ON dep.id = p_dep.department_id
    WHERE en_dep.student_id = s.id
    ORDER BY en_dep.id DESC
    LIMIT 1
  ),
  (
    SELECT dep.name
    FROM fines f_dep
    INNER JOIN events ev_dep ON ev_dep.id = f_dep.event_id AND ev_dep.status = 'Completed'
    INNER JOIN event_audiences ea_dep ON ea_dep.event_id = ev_dep.id AND ea_dep.department_id IS NOT NULL
    INNER JOIN departments dep ON dep.id = ea_dep.department_id
    WHERE f_dep.student_id = s.id
    ORDER BY f_dep.id DESC
    LIMIT 1
  ),
  (
    SELECT dep.name
    FROM fines f_dep
    INNER JOIN events ev_dep ON ev_dep.id = f_dep.event_id AND ev_dep.status = 'Completed'
    INNER JOIN users u_dep ON u_dep.id = ev_dep.created_by AND u_dep.department_id IS NOT NULL
    INNER JOIN departments dep ON dep.id = u_dep.department_id
    WHERE f_dep.student_id = s.id
    ORDER BY f_dep.id DESC
    LIMIT 1
  )
)`;

export function inferDepartmentFromCourse(courseRaw: string | null | undefined): string | null {
  const course = String(courseRaw ?? "").trim().toUpperCase();
  if (!course || course === "—" || course === "UNDECLARED") return null;
  if (course.startsWith("BEED") || course.startsWith("BSED")) {
    return "College of Education, Arts and Sciences";
  }
  if (course.startsWith("BSIT")) return "College of Information Technology";
  if (course.startsWith("BSCRIM")) return "College of Criminal Justice Education";
  if (course.startsWith("BSHM")) return "College of Hospitality Management";
  if (course.startsWith("BSBA")) return "College of Business Administration";
  return null;
}

export function resolveStudentDepartmentName(
  departmentName: string | null | undefined,
  courseCode: string | null | undefined,
): string {
  const fromDb = departmentName != null ? String(departmentName).trim() : "";
  if (fromDb) return fromDb;
  return inferDepartmentFromCourse(courseCode) ?? "—";
}
