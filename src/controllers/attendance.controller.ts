import { Request, Response } from "express";
import { pool } from "../config/db";

export class AttendanceController {

  private getManilaDateTime(): { currentDate: string; currentTime: string } {

      // 🧪 TESTING OVERRIDE
  //  return {
  //   currentDate: "2026-04-02",  // match an ongoing event's date
  //   currentTime: "18:30:00",    // simulate a specific time
  // };
    
    // normal code below (unreachable during testing)
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
              pm_time_in, pm_grace_in, pm_time_out
       FROM events
       WHERE status = 'Ongoing'
         AND date = ?
       LIMIT 1`,
      [currentDate]
    );
    return (rows as any[])[0] ?? null;
  }

  private async findProgramByCourseCode(courseKey: string) {
    const [rows] = await pool.execute(
      `SELECT id FROM programs WHERE course_code = ?`,
      [courseKey]
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
       ON DUPLICATE KEY UPDATE ${column} = ?`,
      [studentId, eventId, currentTime, currentTime]
    );
  }

  private async findAttendanceRecord(studentId: number, eventId: number) {
    const [rows] = await pool.execute(
      `SELECT id FROM attendance WHERE student_id = ? AND event_id = ?`,
      [studentId, eventId]
    );
    return (rows as any[])[0] ?? null;
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

  public recordAttendance = async (req: Request, res: Response): Promise<void> => {
    const { studentId, attendanceKind, courseKey } = req.body;

    if (!studentId || !attendanceKind || !courseKey) {
      res.status(400).json({ message: "studentId, attendanceKind, and courseKey are required." });
      return;
    }

    if (attendanceKind !== "in" && attendanceKind !== "out") {
      res.status(400).json({ message: "attendanceKind must be 'in' or 'out'." });
      return;
    }

    const { currentDate, currentTime } = this.getManilaDateTime();

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

      const program = await this.findProgramByCourseCode(courseKey);
      if (!program) {
        res.status(404).json({ message: "Program not found." });
        return;
      }

      const slot = this.determineSlot(currentTime, event.pm_time_in);
      const isAM = slot === "AM";

      if (attendanceKind === "in") {
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
        const column = isAM ? "am_time_out" : "pm_time_out";
        await this.recordTimeOut(student.id, event.id, column, currentTime);
      }

      res.status(200).json({ message: `Attendance ${attendanceKind} recorded successfully.` });

    } catch (error) {
      console.error("[AttendanceController] Error:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}