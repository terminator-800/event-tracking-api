import { Request, Response } from "express";
import { pool } from "../config/db";
import { getManilaDateTime } from "../utils/manilaDateTime";
import { SQL_STUDENT_YEAR_LEVEL } from "../utils/studentDisplaySql";
import { sqlLatestEnrollmentLeftJoin } from "../utils/studentEligibilitySql";
import { verifyEventPassword as compareEventPassword } from "./services/event-password.service";
import { signEventUnlockToken, verifyEventUnlockToken } from "../utils/eventUnlockToken";
import { getActiveAcademicPeriod } from "../repositories/academic-periods.repository";

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
  const simulatedDate = this.parseSimulatedDate(simulated?.date);
  const simulatedTime = this.parseSimulatedTime(simulated?.time);
  return getManilaDateTime({
    overrideDate: simulatedDate,
    overrideTime: simulatedTime,
  });
}

private async findStudentByStudentId(studentId: string) {
  const [rows] = await pool.execute(
    `SELECT id FROM students WHERE student_id = ?`,
    [studentId]
  );
  return (rows as any[])[0] ?? null;
}

private async findStudentByRfid(rfid: string) {
  const [rows] = await pool.execute(
    `SELECT id FROM students WHERE rfid = ?`,
    [rfid]
  );
  return (rows as any[])[0] ?? null;
}

private async findStudentByIdentifier(identifier: string) {
  const value = String(identifier ?? "").trim();
  if (!value) return null;
  const [rows] = await pool.execute(
    `SELECT id FROM students WHERE student_id = ? OR rfid = ? LIMIT 1`,
    [value, value],
  );
  return (rows as any[])[0] ?? null;
}

private async findOngoingEvent(currentDate: string) {
  const activePeriod = await getActiveAcademicPeriod();
  const periodSql = activePeriod ? " AND academic_period_id = ?" : " AND 1=0";
  const params: (string | number)[] = [currentDate];
  if (activePeriod) params.push(activePeriod.id);

  const [rows] = await pool.execute(
    `SELECT id, duration, event_mode, fine_amount,
            am_time_in, am_grace_in, am_time_out,
            pm_time_in, pm_grace_in, pm_time_out,
            is_all_departments, attendance_password_hash, academic_period_id
      FROM events
      WHERE status = 'Ongoing'
        AND date = ?
        ${periodSql}
      ORDER BY id ASC
      LIMIT 1`,
    params,
  );
  return (rows as any[])[0] ?? null;
}

/** When the client sends eventId (multiple ongoing events same day), resolve that row only. */
private async findOngoingEventById(eventId: number, currentDate: string) {
  const activePeriod = await getActiveAcademicPeriod();
  const periodSql = activePeriod ? " AND academic_period_id = ?" : " AND 1=0";
  const params: (string | number)[] = [eventId, currentDate];
  if (activePeriod) params.push(activePeriod.id);

  const [rows] = await pool.execute(
    `SELECT id, duration, event_mode, fine_amount,
            am_time_in, am_grace_in, am_time_out,
            pm_time_in, pm_grace_in, pm_time_out,
            is_all_departments, attendance_password_hash, academic_period_id
      FROM events
      WHERE id = ?
        AND status = 'Ongoing'
        AND date = ?
        ${periodSql}
      LIMIT 1`,
    params,
  );
  return (rows as any[])[0] ?? null;
}

private eventRequiresAttendancePassword(event: {
  attendance_password_hash?: string | null;
}): boolean {
  return Boolean(event?.attendance_password_hash);
}

private isEventUnlockTokenValid(
  eventId: number,
  rawToken: unknown,
): boolean {
  const token = String(rawToken ?? "").trim();
  if (!token) return false;
  const payload = verifyEventUnlockToken(token);
  return payload?.eventId === Number(eventId);
}

private assertEventAttendanceUnlocked(
  event: { id: number; attendance_password_hash?: string | null },
  rawToken: unknown,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!this.eventRequiresAttendancePassword(event)) {
    return { ok: true };
  }
  if (!this.isEventUnlockTokenValid(event.id, rawToken)) {
    return {
      ok: false,
      status: 403,
      message: "Event password is required. Unlock attendance on the homepage first.",
    };
  }
  return { ok: true };
}

private async recordTimeIn(
  studentId: number,
  eventId: number,
  academicPeriodId: number | null,
  column: string,
  currentTime: string,
) {
  await pool.execute(
    `INSERT INTO attendance (student_id, event_id, academic_period_id, ${column})
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        ${column} = IF(${column} IS NULL, VALUES(${column}), ${column}),
        academic_period_id = COALESCE(attendance.academic_period_id, VALUES(academic_period_id))`,
    [studentId, eventId, academicPeriodId, currentTime],
  );
}

private async recordTimeOut(
  studentId: number,
  eventId: number,
  academicPeriodId: number | null,
  column: string,
  currentTime: string,
) {
  await pool.execute(
    `INSERT INTO attendance (student_id, event_id, academic_period_id, ${column})
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        ${column} = IF(${column} IS NULL, VALUES(${column}), ${column}),
        academic_period_id = COALESCE(attendance.academic_period_id, VALUES(academic_period_id))`,
    [studentId, eventId, academicPeriodId, currentTime],
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

private isTimeInOnlyEvent(event: { event_mode?: string | null }): boolean {
  return String(event?.event_mode ?? "").trim().toUpperCase() === "TIME_IN_ONLY";
}

private inferAttendanceKindFromSlot(
  attendance: any,
  slot: "AM" | "PM",
  timeInOnly = false,
): "in" | "out" {
  if (!attendance) return "in";
  if (timeInOnly) {
    // Time-In Only events never switch to time-out.
    return "in";
  }
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

private async createLateFine(
  studentId: number,
  eventId: number,
  attendanceId: number | null,
  academicPeriodId: number | null,
  reason: string,
  amount: number,
) {
  await pool.execute(
    `INSERT IGNORE INTO fines (student_id, event_id, attendance_id, academic_period_id, reason, amount)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [studentId, eventId, attendanceId, academicPeriodId, reason, amount],
  );
}

private isLateArrival(scheduledIn: string, graceMinutes: number, currentTime: string): boolean {
  const [schedH, schedM] = scheduledIn.split(":").map(Number);
  const [currH,  currM]  = currentTime.split(":").map(Number);
  const scheduledMinutes = schedH * 60 + schedM;
  const currentMinutes   = currH  * 60 + currM;
  return currentMinutes > scheduledMinutes + graceMinutes;
}

/** True once Late – Time In grace has ended: Time In Cutoff (no present tap). */
private isTimeInCutoff(
  scheduledIn: string | null | undefined,
  graceMinutes: number | null | undefined,
  currentTime: string,
): boolean {
  if (scheduledIn == null || String(scheduledIn).trim() === "") return false;
  const grace = Number(graceMinutes);
  const graceSafe = Number.isFinite(grace) && grace > 0 ? grace : 0;
  return this.isLateArrival(String(scheduledIn), graceSafe, currentTime);
}

/**
 * Must match how the kiosk decides AM vs PM for recording columns (`am_*` vs `pm_*`).
 * AM-only events often have `pm_time_in` NULL — comparing only to a noon fallback wrongly
 * routes afternoon taps to PM so `pm_time_out` fills while reports read `am_time_out`.
 */
private determineSlot(
  currentTime: string,
  event: { duration?: string; pm_time_in?: string | null; am_time_in?: string | null },
): "AM" | "PM" {
  const d = String(event?.duration ?? "");
  if (d === "AM Only") return "AM";
  if (d === "PM Only") return "PM";
  if (d === "Half Day") {
    const hasAm = event?.am_time_in != null && String(event.am_time_in).trim() !== "";
    const hasPm = event?.pm_time_in != null && String(event.pm_time_in).trim() !== "";
    if (hasAm && !hasPm) return "AM";
    if (!hasAm && hasPm) return "PM";
  }
  const pmIn = event?.pm_time_in ?? "12:00:00";
  return currentTime < pmIn ? "AM" : "PM";
}

private canRecordTimeOut(slot: "AM" | "PM", event: any, currentTime: string): boolean {
  const scheduledOut = slot === "AM" ? event?.am_time_out : event?.pm_time_out;
  if (!scheduledOut) return true;
  return currentTime >= scheduledOut;
}

private async isStudentInEventAudience(studentId: number, eventId: number, isAllDepartments: boolean): Promise<boolean> {
  const [eventRows] = await pool.execute(
    `SELECT academic_period_id FROM events WHERE id = ? LIMIT 1`,
    [eventId],
  );
  const eventPeriodId = (eventRows as any[])[0]?.academic_period_id ?? null;
  const activePeriod = eventPeriodId == null ? await getActiveAcademicPeriod() : null;
  const periodId = eventPeriodId != null ? Number(eventPeriodId) : activePeriod?.id ?? null;
  const enrollmentJoin = sqlLatestEnrollmentLeftJoin(periodId);

  if (isAllDepartments) {
    const [audienceRows] = await pool.execute(
      `SELECT year_level FROM event_audiences WHERE event_id = ? AND year_level IS NOT NULL LIMIT 1`,
      [eventId],
    );
    const audience = (audienceRows as any[])[0];

    const [rows] = await pool.execute(
      `SELECT s.id
       FROM students s
       ${enrollmentJoin}
       WHERE s.id = ?
         AND en.id IS NOT NULL
         ${audience ? `AND ${SQL_STUDENT_YEAR_LEVEL} = ?` : ""}
       LIMIT 1`,
      audience ? [studentId, audience.year_level] : [studentId],
    );
    return (rows as any[]).length > 0;
  }

  const [rows] = await pool.execute(
    `SELECT 1 AS ok
     FROM students s
     ${enrollmentJoin}
     LEFT JOIN programs p ON p.id = en.program_id
     WHERE s.id = ?
       AND en.id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM event_audiences ea
         WHERE ea.event_id = ?
           AND (ea.department_id IS NULL OR ea.department_id = p.department_id)
           AND (ea.program_id IS NULL OR ea.program_id = en.program_id)
           AND (ea.year_level IS NULL OR ea.year_level = ${SQL_STUDENT_YEAR_LEVEL})
       )
     LIMIT 1`,
    [studentId, eventId],
  );
  return (rows as any[]).length > 0;
}

public verifyEventPassword = async (req: Request, res: Response): Promise<void> => {
  const parsedEventId = Number(req.body?.eventId);
  const password = String(req.body?.password ?? "").trim();

  if (!Number.isFinite(parsedEventId)) {
    res.status(400).json({ message: "eventId is required." });
    return;
  }
  if (!password) {
    res.status(400).json({ message: "password is required." });
    return;
  }

  const { currentDate } = this.getManilaDateTime({
    date: req.body?.simulatedDate,
    time: req.body?.simulatedTapTime,
  });

  try {
    const event = await this.findOngoingEventById(parsedEventId, currentDate);
    if (!event) {
      res.status(404).json({ message: "Event not found or not ongoing today." });
      return;
    }

    if (!this.eventRequiresAttendancePassword(event)) {
      res.status(200).json({
        unlockToken: signEventUnlockToken(event.id),
        requiresPassword: false,
      });
      return;
    }

    const isValid = await compareEventPassword(password, event.attendance_password_hash);
    if (!isValid) {
      res.status(401).json({ message: "Incorrect event password." });
      return;
    }

    res.status(200).json({
      unlockToken: signEventUnlockToken(event.id),
      requiresPassword: true,
    });
  } catch (error) {
    console.error("[AttendanceController.verifyEventPassword] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

public recordAttendance = async (req: Request, res: Response): Promise<void> => {
  const {
    identifier: rawIdentifier,
    studentId: rawStudentId,
    rfid: rawRfid,
    simulatedTapTime,
    simulatedDate,
    attendanceKind,
    eventId: rawEventId,
    eventUnlockToken,
  } = req.body;
  const identifier = String(rawIdentifier ?? "").trim();
  const studentId = String(rawStudentId ?? "").trim();
  const rfid = String(rawRfid ?? "").trim();
  const requestedKind = this.parseAttendanceKind(attendanceKind);
  console.log("[AttendanceController] Received attendance record request:", {
    identifier: identifier || undefined,
    studentId: studentId || undefined,
    rfid: rfid || undefined,
    simulatedTapTime,
    simulatedDate,
    attendanceKind: requestedKind,
    eventId: rawEventId,
  });

  if (studentId && rfid) {
    res.status(400).json({ message: "Provide either studentId or rfid, not both." });
    return;
  }

  const lookupValue = identifier || studentId || rfid;
  if (!lookupValue) {
    res.status(400).json({ message: "identifier, studentId, or rfid is required." });
    return;
  }

  const { currentDate, currentTime } = this.getManilaDateTime({
    date: simulatedDate,
    time: simulatedTapTime,
  });

  try {
    const student = await this.findStudentByIdentifier(lookupValue);
    if (!student) {
      res.status(404).json({ message: "Student not found." });
      return;
    }

    let event: any = null;
    const parsedEventId =
      rawEventId === undefined || rawEventId === null || rawEventId === ""
        ? null
        : Number(rawEventId);
    if (parsedEventId != null) {
      if (!Number.isFinite(parsedEventId)) {
        res.status(400).json({ message: "Invalid eventId." });
        return;
      }
      event = await this.findOngoingEventById(parsedEventId, currentDate);
      if (!event) {
        res.status(404).json({
          message: "That event is not ongoing today, or no longer matches this date.",
        });
        return;
      }
    } else {
      event = await this.findOngoingEvent(currentDate);
      if (!event) {
        res.status(404).json({ message: "No ongoing event found." });
        return;
      }
    }

    const unlockCheck = this.assertEventAttendanceUnlocked(event, eventUnlockToken);
    if (!unlockCheck.ok) {
      res.status(unlockCheck.status).json({ message: unlockCheck.message });
      return;
    }

    const isAllowed = await this.isStudentInEventAudience(student.id, event.id, event.is_all_departments);
    if (!isAllowed) {
      res.status(403).json({ message: "Student is not part of this event's audience." });
      return;
    }

    const slot = this.determineSlot(currentTime, event);
    const isAM = slot === "AM";
    const timeInOnly = this.isTimeInOnlyEvent(event);
    const academicPeriodId =
      event.academic_period_id != null && Number.isFinite(Number(event.academic_period_id))
        ? Number(event.academic_period_id)
        : (await getActiveAcademicPeriod())?.id ?? null;
    const attendanceRow = await this.findAttendanceRow(student.id, event.id);
    const { timeInDone, timeOutDone } = this.getSlotAttendanceStatus(attendanceRow, slot);
    const inferredKind = this.inferAttendanceKindFromSlot(attendanceRow, slot, timeInOnly);
    const resolvedAttendanceKind = requestedKind ?? inferredKind;

    if (timeInOnly && (requestedKind === "out" || resolvedAttendanceKind === "out")) {
      res.status(409).json({
        status: "time_out_disabled",
        message: `${slot} time out is disabled for this Time-In Only event. Time in marks attendance as Present.`,
      });
      return;
    }

    if (timeInOnly && timeInDone) {
      res.status(409).json({
        status: "already_submitted",
        message: `${slot} time in is already recorded. Student is Present for this Time-In Only event.`,
      });
      return;
    }

    if (requestedKind === "in" && inferredKind === "out") {
      res.status(409).json({
        status: "already_submitted",
        message: `${slot} time in is already recorded for this student.`,
      });
      return;
    }

    if (resolvedAttendanceKind === "in") {
      const scheduledIn = isAM ? event.am_time_in : event.pm_time_in;
      const graceIn = isAM ? event.am_grace_in : event.pm_grace_in;
      const cutoff = this.isTimeInCutoff(scheduledIn, graceIn, currentTime);

      if (cutoff) {
        // After Late – Time In ends: do not record present; mark Absent for this session.
        if (!timeInDone) {
          await this.createLateFine(
            student.id,
            event.id,
            null,
            academicPeriodId,
            isAM ? "Absent AM" : "Absent PM",
            event.fine_amount,
          );
        }
        res.status(200).json({
          status: "time_in_cutoff",
          message: timeInDone
            ? `${slot} time in was already closed (Time In Cutoff).`
            : `${slot} Time In Cutoff: tap was not recorded. Student marked Absent.`,
          attendanceKind: "in",
          slot,
        });
        return;
      }

      const column = isAM ? "am_time_in" : "pm_time_in";
      await this.recordTimeIn(student.id, event.id, academicPeriodId, column, currentTime);

      res.status(200).json({
        message: timeInOnly
          ? `Attendance time in recorded successfully. Student marked Present (${slot} Time-In Only).`
          : `Attendance in recorded successfully.`,
        status: timeInOnly ? "present" : undefined,
        attendanceKind: "in",
        eventMode: timeInOnly ? "TIME_IN_ONLY" : "TIME_IN_OUT",
      });
      return;

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
      await this.recordTimeOut(student.id, event.id, academicPeriodId, column, currentTime);
    }

    res.status(200).json({ message: `Attendance ${resolvedAttendanceKind} recorded successfully.` });

  } catch (error) {
    console.error("[AttendanceController] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
  }