/** Normalize school year text, e.g. "sy2025-2026" → "SY2025-2026". */
export function normalizeSchoolYear(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const upper = text.toUpperCase();
  if (upper.startsWith("SY")) return upper.replace(/\s+/g, "");
  if (/^\d{4}-\d{4}$/.test(text)) return `SY${text}`;
  return upper.replace(/\s+/g, "");
}

/** Normalize semester to canonical values used in DB ENUM. */
export function normalizeSemester(raw: unknown): "1st sem" | "2nd sem" | "summer" | "" {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "";
  if (text === "1" || text === "1st" || text === "1st sem" || text === "first sem" || text === "first semester") {
    return "1st sem";
  }
  if (text === "2" || text === "2nd" || text === "2nd sem" || text === "second sem" || text === "second semester") {
    return "2nd sem";
  }
  if (text.includes("summer")) return "summer";
  return "";
}

export function formatAcademicPeriodLabel(schoolYear: string, semester: string): string {
  return `${schoolYear} · ${semester}`;
}
