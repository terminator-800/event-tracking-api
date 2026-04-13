/** Format MySQL TIME / "HH:MM:SS" as "h:mm AM/PM" for dashboard display. */
export function sqlTimeTo12Hour(t: string | null | undefined): string | null {
  if (t == null || String(t).trim() === "") return null;
  const raw = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const isPm = h >= 12;
  const dispH = h % 12 === 0 ? 12 : h % 12;
  const suffix = isPm ? "PM" : "AM";
  return `${dispH}:${String(min).padStart(2, "0")} ${suffix}`;
}
