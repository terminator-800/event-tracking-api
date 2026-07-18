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

/**
 * Parse exported time cells back to MySQL TIME ("HH:MM:SS").
 * Accepts "h:mm AM/PM", "HH:MM", "HH:MM:SS", or empty/"—"/"No record".
 */
export function parseTimeCellToSql(val: unknown): string | null {
  if (val == null) return null;
  const raw = String(val).trim();
  if (!raw || raw === "—" || /^no record$/i.test(raw)) return null;

  const ampm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(raw);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2]);
    const sec = Number(ampm[3] ?? 0);
    const isPm = ampm[4].toUpperCase() === "PM";
    if (h < 1 || h > 12 || min > 59 || sec > 59) return null;
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const h24 = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (h24) {
    const h = Number(h24[1]);
    const min = Number(h24[2]);
    const sec = Number(h24[3] ?? 0);
    if (h > 23 || min > 59 || sec > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  return null;
}
