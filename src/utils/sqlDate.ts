/**
 * Serialize MySQL DATE/DATETIME for JSON as YYYY-MM-DD.
 * mysql2 returns JavaScript `Date` for DATE columns — never use `String(date).slice(0, 10)`:
 * that takes the first 10 chars of `Date#toString()` (e.g. `"Mon Feb 16"`), which the client
 * may parse as the wrong year (e.g. 2001).
 */
export function toYmdDateString(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (m) return m[1];
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return ymdFromLocalDate(d);
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return ymdFromLocalDate(value);
  }
  return String(value);
}

function ymdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
