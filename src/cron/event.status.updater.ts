import cron from 'node-cron';
import { pool } from "../config/db";

let isCronRunInProgress = false;

function getManilaDateTime(): { currentDate: string; currentTime: string } {
      // 🧪 TESTING OVERRIDE
  // return {
  //   currentDate: "2026-04-21",
  //   currentTime: "18:00:00", 
  // };
  const now = new Date();
  const manilaLocale = now.toLocaleString("en-CA", { timeZone: "Asia/Manila", hour12: false });
  const [currentDate, currentTime] = manilaLocale.split(", ");
  return { currentDate, currentTime };
}

async function markOngoingEvents(currentDate: string, currentTime: string): Promise<number> {
  const [result] = await pool.execute(
    `UPDATE events
     SET status = 'Ongoing'
     WHERE date = ?
       AND status = 'Upcoming'
       AND COALESCE(am_time_in, pm_time_in) IS NOT NULL
       AND COALESCE(am_time_in, pm_time_in) <= ?`,
    [currentDate, currentTime]
  );
  return (result as any).affectedRows;
}

async function markCompletedEvents(currentDate: string, currentTime: string): Promise<number> {
  const [result] = await pool.execute(
    `UPDATE events
     SET status = 'Completed'
     WHERE date = ?
       AND status = 'Ongoing'
       AND (
         (duration = 'AM Only'                    AND am_time_out < ?)
         OR (duration = 'PM Only'                 AND pm_time_out < ?)
         OR (duration IN ('Whole Day', 'Half Day') AND pm_time_out < ?)
       )`,
    [currentDate, currentTime, currentTime, currentTime]
  );
  return (result as any).affectedRows;
}

async function markStalledEvents(currentDate: string): Promise<number> {
  const [result] = await pool.execute(
    `UPDATE events
     SET status = 'Completed'
     WHERE date < ?
       AND status IN ('Ongoing', 'Upcoming')`,
    [currentDate]
  );
  return (result as any).affectedRows;
}

async function generateEndOfEventFines(currentDate: string): Promise<void> {
  const [events] = await pool.execute(
    `SELECT id, duration, fine_amount, is_all_departments, am_time_out, pm_time_out
     FROM events
     WHERE status = 'Completed'
       AND date <= ?
       AND fines_generated = FALSE`,
    [currentDate]
  );

  for (const event of events as any[]) {
    const isWholeOrHalf = ['Whole Day', 'Half Day'].includes(event.duration);
    const isAMOnly      = event.duration === 'AM Only';
    const isPMOnly      = event.duration === 'PM Only';

    let eligibleStudentsSql = `SELECT DISTINCT s.id as student_id
      FROM students s
      JOIN enrollments e ON e.student_id = s.id`;
    const eligibleParams: any[] = [];

    if (Number(event.is_all_departments) === 1) {
      const [audRows] = await pool.execute(
        `SELECT year_level FROM event_audiences WHERE event_id = ? AND year_level IS NOT NULL LIMIT 1`,
        [event.id]
      );
      const audience = (audRows as any[])[0];
      if (audience?.year_level != null) {
        eligibleStudentsSql += ` WHERE e.year_level = ?`;
        eligibleParams.push(audience.year_level);
      }
    } else {
      eligibleStudentsSql += `
        JOIN event_audiences ea ON ea.program_id = e.program_id
        WHERE ea.event_id = ?`;
      eligibleParams.push(event.id);
    }

    const eligibleStudentsCte = `(${eligibleStudentsSql}) es`;

    if (isWholeOrHalf || isAMOnly) {
      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, NULL, 'Absent AM', ?
         FROM ${eligibleStudentsCte}
         LEFT JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.id IS NULL OR a.am_time_in IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );

      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, NULL, 'Absent AM Time Out', ?
         FROM ${eligibleStudentsCte}
         LEFT JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.id IS NULL OR a.am_time_in IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );

      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, a.id, 'Missed AM Time Out', ?
         FROM ${eligibleStudentsCte}
         INNER JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.am_time_in IS NOT NULL AND a.am_time_out IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );
    }

    if (isWholeOrHalf || isPMOnly) {
      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, NULL, 'Absent PM', ?
         FROM ${eligibleStudentsCte}
         LEFT JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.id IS NULL OR a.pm_time_in IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );

      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, NULL, 'Absent PM Time Out', ?
         FROM ${eligibleStudentsCte}
         LEFT JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.id IS NULL OR a.pm_time_in IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );

      await pool.execute(
        `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
         SELECT es.student_id, ?, a.id, 'Missed PM Time Out', ?
         FROM ${eligibleStudentsCte}
         INNER JOIN attendance a ON a.student_id = es.student_id AND a.event_id = ?
         WHERE a.pm_time_in IS NOT NULL AND a.pm_time_out IS NULL`,
        [event.id, event.fine_amount, event.id, ...eligibleParams]
      );
    }

    // ✅ Mark event as processed so cron skips it next time
    await pool.execute(
      `UPDATE events SET fines_generated = TRUE WHERE id = ?`,
      [event.id]
    );
  }
}

async function updateEventStatuses(): Promise<void> {
  if (isCronRunInProgress) {
    console.log("[EventCron] Previous run still in progress; skipping this tick.");
    return;
  }
  isCronRunInProgress = true;
  const { currentDate, currentTime } = getManilaDateTime();

  try {
    const ongoing = await markOngoingEvents(currentDate, currentTime);

    const [completed, stalled] = await Promise.all([
      markCompletedEvents(currentDate, currentTime),
      markStalledEvents(currentDate),
    ]);

    // ✅ Update the call in updateEventStatuses
    await generateEndOfEventFines(currentDate);

    console.log(
      `[EventCron] ${currentDate} ${currentTime} | ` +
      `Ongoing: ${ongoing} | ` +
      `Completed: ${completed} | ` +
      `Stalled→Completed: ${stalled}`
    );
  } catch (error) {
    console.error('[EventCron] Failed to update event statuses:', error);
  } finally {
    isCronRunInProgress = false;
  }
}

// Main Function
export function registerEventStatusCron(): void {
  cron.schedule('* * * * *', updateEventStatuses, {
    timezone: 'Asia/Manila',
  });

  console.log('[EventCron] Event status updater registered.');
}