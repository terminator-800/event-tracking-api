type ManilaNowOptions = {
  overrideDate?: string | null;
  overrideTime?: string | null;
};

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function normalizeTime(value: string | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  return /^\d{2}:\d{2}:\d{2}$/.test(v) ? v : null;
}

function getRealManilaDateTime(): { currentDate: string; currentTime: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const hourRaw = get("hour");
  // Some engines emit "24" for midnight under hour12:false — normalize to 00.
  const hour = hourRaw === "24" ? "00" : hourRaw.padStart(2, "0");

  return {
    currentDate: `${get("year")}-${get("month")}-${get("day")}`,
    currentTime: `${hour}:${get("minute").padStart(2, "0")}:${get("second").padStart(2, "0")}`,
  };
}

/**
 * Shared clock source for cron and attendance.
 * Priority:
 * 1) explicit runtime overrides (e.g. request simulated date/time)
 * 2) env test overrides (non-production only)
 * 3) real Asia/Manila clock
 */
export function getManilaDateTime(options: ManilaNowOptions = {}): { currentDate: string; currentTime: string } {
  const real = getRealManilaDateTime();

  const runtimeDate = normalizeDate(options.overrideDate ?? undefined);
  const runtimeTime = normalizeTime(options.overrideTime ?? undefined);
  if (runtimeDate || runtimeTime) {
    return {
      currentDate: runtimeDate ?? real.currentDate,
      currentTime: runtimeTime ?? real.currentTime,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    const envDate = normalizeDate(process.env.TEST_MANILA_DATE);
    const envTime = normalizeTime(process.env.TEST_MANILA_TIME);
    if (envDate || envTime) {
      return {
        currentDate: envDate ?? real.currentDate,
        currentTime: envTime ?? real.currentTime,
      };
    }
  }

  return real;
}
