export function to24Hour(time: string | null | undefined): string | null {
    if (!time) return null;
  
    const [timePart, meridiem] = time.trim().split(" ");
    let [h, m] = timePart.split(":").map(Number);
  
    if (meridiem?.toUpperCase() === "PM" && h !== 12) h += 12;
    if (meridiem?.toUpperCase() === "AM" && h === 12) h = 0;
  
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  
 export function parseYearLevel(yearLevel: string | null | undefined): number | null {
    if (!yearLevel || yearLevel === "All Year Levels") return null;
    const match = yearLevel.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }
  