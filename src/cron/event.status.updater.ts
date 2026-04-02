import cron from 'node-cron';
import { pool } from "../config/db";

function getManilaDateTime(): { currentDate: string; currentTime: string } {
      // 🧪 TESTING OVERRIDE
//   return {
//     currentDate: "2026-04-02",
//     currentTime: "18:01:00", // 👈 1 minute past pm_time_out 18:00:00
//   };
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
       AND am_time_in <= ?`,
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
       AND date = ?
       AND fines_generated = FALSE`,
    [currentDate]
  );

  for (const event of events as any[]) {
    const studentsQuery = event.is_all_departments
      ? `SELECT DISTINCT s.id as student_id
         FROM students s
         JOIN enrollments e ON e.student_id = s.id`
      : `SELECT DISTINCT s.id as student_id
         FROM students s
         JOIN enrollments e ON e.student_id = s.id
         JOIN event_audiences ea ON ea.program_id = e.program_id
         WHERE ea.event_id = ?`;

    const studentsParams = event.is_all_departments ? [] : [event.id];
    const [students] = await pool.execute(studentsQuery, studentsParams);

    for (const student of students as any[]) {
      const [attRows] = await pool.execute(
        `SELECT id, am_time_in, am_time_out, pm_time_in, pm_time_out
         FROM attendance
         WHERE student_id = ? AND event_id = ?`,
        [student.student_id, event.id]
      );
      const att = (attRows as any[])[0] ?? null;

      const isWholeOrHalf = ['Whole Day', 'Half Day'].includes(event.duration);
      const isAMOnly      = event.duration === 'AM Only';
      const isPMOnly      = event.duration === 'PM Only';

      if (isWholeOrHalf || isAMOnly) {
        if (!att || !att.am_time_in) {
          await pool.execute(
            `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
             VALUES (?, ?, NULL, 'Absent AM', ?)`,
            [student.student_id, event.id, event.fine_amount]
          );
        }
        if (att?.am_time_in && !att.am_time_out) {
          await pool.execute(
            `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
             VALUES (?, ?, ?, 'Missed AM Time Out', ?)`,
            [student.student_id, event.id, att.id, event.fine_amount]
          );
        }
      }

      if (isWholeOrHalf || isPMOnly) {
        if (!att || !att.pm_time_in) {
          await pool.execute(
            `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
             VALUES (?, ?, NULL, 'Absent PM', ?)`,
            [student.student_id, event.id, event.fine_amount]
          );
        }
        if (att?.pm_time_in && !att.pm_time_out) {
          await pool.execute(
            `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
             VALUES (?, ?, ?, 'Missed PM Time Out', ?)`,
            [student.student_id, event.id, att.id, event.fine_amount]
          );
        }
      }
    }

    // ✅ Mark event as processed so cron skips it next time
    await pool.execute(
      `UPDATE events SET fines_generated = TRUE WHERE id = ?`,
      [event.id]
    );
  }
}

async function updateEventStatuses(): Promise<void> {
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
  }
}

// Main Function
export function registerEventStatusCron(): void {
  cron.schedule('* * * * *', updateEventStatuses, {
    timezone: 'Asia/Manila',
  });

  console.log('[EventCron] Event status updater registered.');
}