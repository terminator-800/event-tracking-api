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
  const now = new Date();
  const manilaLocale = now.toLocaleString("en-CA", { timeZone: "Asia/Manila", hour12: false });
  const [currentDate, currentTime] = manilaLocale.split(", ");
  return { currentDate, currentTime };
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
