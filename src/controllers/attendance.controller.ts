  import { Request, Response } from "express";
  import { pool } from "../config/db";

export class AttendanceController {

private parseSimulatedTime(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.length === 5 ? `${v}:00` : v;
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(v);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const mer = m[3].toUpperCase();
  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
  if (mer === "AM") {
    if (hh === 12) hh = 0;
  } else if (hh !== 12) {
    hh += 12;
  }
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

private parseSimulatedDate(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

private parseAttendanceKind(raw: unknown): "in" | "out" | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === "in" || v === "out") return v;
  return null;
}

private getManilaDateTime(simulated?: { date?: unknown; time?: unknown }): { currentDate: string; currentTime: string } {
  if (process.env.NODE_ENV !== "production") {
    const simulatedDate = this.parseSimulatedDate(simulated?.date);
    const simulatedTime = this.parseSimulatedTime(simulated?.time);
    if (simulatedDate || simulatedTime) {
      const now = new Date();
      const manilaLocale = now.toLocaleString("en-CA", { timeZone: "Asia/Manila", hour12: false });
      const [currentDateRaw, currentTimeRaw] = manilaLocale.split(", ");
      return {
        currentDate: simulatedDate ?? currentDateRaw,
        currentTime: simulatedTime ?? currentTimeRaw,
      };
    }
  }

  // 🧪 TESTING OVERRIDE (default fallback while testing)
  // return {
  //   currentDate: "2026-04-23",
  //   currentTime: "11:45:00",
  // };

  const now = new Date();
  const manilaLocale = now.toLocaleString("en-CA", { timeZone: "Asia/Manila", hour12: false });
  const [currentDate, currentTime] = manilaLocale.split(", ");
  return { currentDate, currentTime };
}

private async findStudentByStudentId(studentId: string) {
  const [rows] = await pool.execute(
    `SELECT id FROM students WHERE student_id = ?`,
    [studentId]
  );
  return (rows as any[])[0] ?? null;
}

private async findOngoingEvent(currentDate: string) {
  const [rows] = await pool.execute(
    `SELECT id, duration, fine_amount,
            am_time_in, am_grace_in, am_time_out,
            pm_time_in, pm_grace_in, pm_time_out,
            is_all_departments
      FROM events
      WHERE status = 'Ongoing'
        AND date = ?
      LIMIT 1`,
    [currentDate]
  );
  return (rows as any[])[0] ?? null;
}

private async recordTimeIn(studentId: number, eventId: number, column: string, currentTime: string) {
  await pool.execute(
    `INSERT INTO attendance (student_id, event_id, ${column})
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE ${column} = IF(${column} IS NULL, VALUES(${column}), ${column})`,
    [studentId, eventId, currentTime]
  );
}

private async recordTimeOut(studentId: number, eventId: number, column: string, currentTime: string) {
  await pool.execute(
    `INSERT INTO attendance (student_id, event_id, ${column})
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE ${column} = IF(${column} IS NULL, VALUES(${column}), ${column})`,
    [studentId, eventId, currentTime]
  );
}

private async findAttendanceRecord(studentId: number, eventId: number) {
  const [rows] = await pool.execute(
    `SELECT id FROM attendance WHERE student_id = ? AND event_id = ?`,
    [studentId, eventId]
  );
  return (rows as any[])[0] ?? null;
}

private async findAttendanceRow(studentId: number, eventId: number) {
  const [rows] = await pool.execute(
    `SELECT id, am_time_in, am_time_out, pm_time_in, pm_time_out
     FROM attendance
     WHERE student_id = ? AND event_id = ?
     LIMIT 1`,
    [studentId, eventId]
  );
  return (rows as any[])[0] ?? null;
}

private inferAttendanceKindFromSlot(
  attendance: any,
  slot: "AM" | "PM"
): "in" | "out" {
  if (!attendance) return "in";
  if (slot === "AM") {
    return attendance.am_time_in ? "out" : "in";
  }
  return attendance.pm_time_in ? "out" : "in";
}

private getSlotAttendanceStatus(
  attendance: any,
  slot: "AM" | "PM"
): { timeInDone: boolean; timeOutDone: boolean } {
  if (slot === "AM") {
    return {
      timeInDone: Boolean(attendance?.am_time_in),
      timeOutDone: Boolean(attendance?.am_time_out),
    };
  }
  return {
    timeInDone: Boolean(attendance?.pm_time_in),
    timeOutDone: Boolean(attendance?.pm_time_out),
  };
}

private async createLateFine(studentId: number, eventId: number, attendanceId: number, reason: string, amount: number) {
  await pool.execute(
    `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, reason, amount)
      VALUES (?, ?, ?, ?, ?)`,
    [studentId, eventId, attendanceId, reason, amount]
  );
}

private isLateArrival(scheduledIn: string, graceMinutes: number, currentTime: string): boolean {
  const [schedH, schedM] = scheduledIn.split(":").map(Number);
  const [currH,  currM]  = currentTime.split(":").map(Number);
  const scheduledMinutes = schedH * 60 + schedM;
  const currentMinutes   = currH  * 60 + currM;
  return currentMinutes > scheduledMinutes + graceMinutes;
}

private determineSlot(currentTime: string, pmTimeIn: string): "AM" | "PM" {
  return currentTime < (pmTimeIn ?? "12:00:00") ? "AM" : "PM";
}

private canRecordTimeOut(slot: "AM" | "PM", event: any, currentTime: string): boolean {
  const scheduledOut = slot === "AM" ? event?.am_time_out : event?.pm_time_out;
  if (!scheduledOut) return true;
  return currentTime >= scheduledOut;
}

private async isStudentInEventAudience(studentId: number, eventId: number, isAllDepartments: boolean): Promise<boolean> {
  if (isAllDepartments) {
    const [audienceRows] = await pool.execute(
      `SELECT year_level FROM event_audiences WHERE event_id = ? LIMIT 1`,
      [eventId]
    );
    const audience = (audienceRows as any[])[0];

    if (!audience) return true;

    const [rows] = await pool.execute(
      `SELECT e.id
      FROM enrollments e
      WHERE e.student_id = ?
        AND (? IS NULL OR e.year_level = ?)
      LIMIT 1`,
      [studentId, audience.year_level, audience.year_level]
    );
    return (rows as any[]).length > 0;
  }

  // ✅ department-specific: check program + year level
  const [rows] = await pool.execute(
    `SELECT ea.id
     FROM event_audiences ea
     JOIN enrollments e ON e.program_id = ea.program_id
     WHERE ea.event_id = ?
       AND e.student_id = ?
       AND (ea.year_level IS NULL OR ea.year_level = e.year_level)
     LIMIT 1`,
    [eventId, studentId]
  );
  return (rows as any[]).length > 0;
}

public recordAttendance = async (req: Request, res: Response): Promise<void> => {
  const { studentId, simulatedTapTime, simulatedDate, attendanceKind } = req.body;
  const requestedKind = this.parseAttendanceKind(attendanceKind);
  console.log("[AttendanceController] Received attendance record request:", {
    studentId,
    simulatedTapTime,
    simulatedDate,
    attendanceKind: requestedKind,
  });

  if (!studentId) {
    res.status(400).json({ message: "studentId is required." });
    return;
  }

  const { currentDate, currentTime } = this.getManilaDateTime({
    date: simulatedDate,
    time: simulatedTapTime,
  });

  try {
    const student = await this.findStudentByStudentId(studentId);
    if (!student) {
      res.status(404).json({ message: "Student not found." });
      return;
    }

    const event = await this.findOngoingEvent(currentDate);
    if (!event) {
      res.status(404).json({ message: "No ongoing event found." });
      return;
    }

    const isAllowed = await this.isStudentInEventAudience(student.id, event.id, event.is_all_departments);
    if (!isAllowed) {
      res.status(403).json({ message: "Student is not part of this event's audience." });
      return;
    }

    const slot = this.determineSlot(currentTime, event.pm_time_in);
    const isAM = slot === "AM";
    const attendanceRow = await this.findAttendanceRow(student.id, event.id);
    const { timeInDone, timeOutDone } = this.getSlotAttendanceStatus(attendanceRow, slot);
    const inferredKind = this.inferAttendanceKindFromSlot(attendanceRow, slot);
    const resolvedAttendanceKind = requestedKind ?? inferredKind;

    if (requestedKind === "in" && inferredKind === "out") {
      res.status(409).json({
        status: "already_submitted",
        message: `${slot} time in is already recorded for this student.`,
      });
      return;
    }

    if (resolvedAttendanceKind === "in") {
      const column = isAM ? "am_time_in" : "pm_time_in";
      await this.recordTimeIn(student.id, event.id, column, currentTime);

      const late = this.isLateArrival(
        isAM ? event.am_time_in : event.pm_time_in,
        isAM ? event.am_grace_in : event.pm_grace_in,
        currentTime
      );

      if (late) {
        const attendance = await this.findAttendanceRecord(student.id, event.id);
        await this.createLateFine(
          student.id,
          event.id,
          attendance.id,
          isAM ? "Late AM" : "Late PM",
          event.fine_amount
        );
      }

    } else {
      if (timeOutDone) {
        res.status(409).json({
          status: "already_submitted",
          message: `${slot} time out is already recorded for this student.`,
        });
        return;
      }

      const canTimeOutNow = this.canRecordTimeOut(slot, event, currentTime);
      if (!canTimeOutNow) {
        res.status(200).json({
          status: "time_out_not_active",
          message: `${slot} time out is not active yet. Please tap again during the time out schedule.`,
        });
        return;
      }

      const column = isAM ? "am_time_out" : "pm_time_out";
      await this.recordTimeOut(student.id, event.id, column, currentTime);
    }

    res.status(200).json({ message: `Attendance ${resolvedAttendanceKind} recorded successfully.` });

  } catch (error) {
    console.error("[AttendanceController] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
  }