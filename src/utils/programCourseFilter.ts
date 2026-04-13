/**
 * Maps DB programs.course_code + major to the same filterValue keys used by the CSG roster catalog.
 */
export function programToCourseFilterValue(courseCode: string, major: string | null | undefined): string {
  const code = String(courseCode ?? "").trim();
  const m = major?.trim() || "";

  if (code === "BSED") {
    if (m === "English") return "BSED_ENG";
    if (m === "Math") return "BSED_MATH";
    if (m === "Filipino") return "BSED_FIL";
    return m ? `BSED_${m.replace(/\s+/g, "_")}` : "BSED";
  }
  if (code === "BSBA") {
    if (m === "Marketing Management") return "BSBA-MM";
    if (m === "Human Resource Development Management") return "BSBA-HRDM";
    if (m === "Financial Management") return "BSBA-FM";
    return m ? `BSBA-${m}` : "BSBA";
  }
  return code;
}

export function parseCourseFilterToProgramMatch(filterValue: string): {
  course_code: string;
  major: string | null;
} {
  if (filterValue === "BSED_ENG") return { course_code: "BSED", major: "English" };
  if (filterValue === "BSED_MATH") return { course_code: "BSED", major: "Math" };
  if (filterValue === "BSED_FIL") return { course_code: "BSED", major: "Filipino" };
  if (filterValue === "BSBA-MM") return { course_code: "BSBA", major: "Marketing Management" };
  if (filterValue === "BSBA-HRDM") return { course_code: "BSBA", major: "Human Resource Development Management" };
  if (filterValue === "BSBA-FM") return { course_code: "BSBA", major: "Financial Management" };
  return { course_code: filterValue, major: null };
}
