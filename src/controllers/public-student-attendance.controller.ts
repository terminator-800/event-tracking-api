import { Request, Response } from "express";
import { sqlTimeTo12Hour } from "../utils/sqlTime";
import {
  findPublicAttendanceHistory,
  findPublicStudentProfile,
  resolveStudentByIdentifier,
  type PublicStudentAttendanceRow,
} from "../repositories/public-student-attendance.repository";

function durationToSessionType(d: string): "Whole day" | "AM Only" | "PM Only" {
  if (d === "Whole Day") return "Whole day";
  if (d === "AM Only") return "AM Only";
  if (d === "PM Only") return "PM Only";
  return "AM Only";
}

/** Payment status for an event's fines (mirrors cashier desk logic). */
function derivePaymentStatus(
  finePhp: number,
  finePaidPhp: number,
  fineWaivedPhp: number,
): "Paid" | "Partial" | "Unpaid" | "Waived" | null {
  const total = Math.max(0, finePhp);
  const paid = Math.max(0, finePaidPhp);
  const waived = Math.max(0, fineWaivedPhp);
  if (total <= 0) return null;
  const remaining = Math.max(0, total - paid - waived);
  const payableBalance = Math.max(0, total - waived);
  if (payableBalance <= 0) return "Waived";
  if (remaining <= 0) return "Paid";
  if (paid > 0 || waived > 0) return "Partial";
  return "Unpaid";
}

function mapHistoryRow(row: PublicStudentAttendanceRow) {
  const sessionType = durationToSessionType(String(row.duration ?? ""));
  const attended = Number(row.attended) === 1;
  const finePhp = row.fine_php != null ? Number(row.fine_php) : 0;
  const finePaidPhp = row.fine_paid_php != null ? Number(row.fine_paid_php) : 0;
  const fineWaivedPhp = row.fine_waived_php != null ? Number(row.fine_waived_php) : 0;
  const paymentStatus = derivePaymentStatus(finePhp, finePaidPhp, fineWaivedPhp);
  const status = String(row.status ?? "Completed");

  if (sessionType !== "Whole day") {
    const hasAmData = row.am_time_in != null || row.am_time_out != null;
    const hasPmData = row.pm_time_in != null || row.pm_time_out != null;
    let useAm = sessionType === "AM Only";
    if (useAm && !hasAmData && hasPmData) useAm = false;
    if (!useAm && !hasPmData && hasAmData) useAm = true;
    const ti = useAm ? row.am_time_in : row.pm_time_in;
    const to = useAm ? row.am_time_out : row.pm_time_out;
    return {
      eventId: Number(row.event_id),
      name: String(row.name ?? ""),
      date: String(row.date ?? ""),
      status,
      sessionType,
      attended,
      timeIn: sqlTimeTo12Hour(ti),
      timeOut: sqlTimeTo12Hour(to),
      amTimeIn: null as string | null,
      amTimeOut: null as string | null,
      pmTimeIn: null as string | null,
      pmTimeOut: null as string | null,
      finePhp,
      paymentStatus,
    };
  }

  return {
    eventId: Number(row.event_id),
    name: String(row.name ?? ""),
    date: String(row.date ?? ""),
    status,
    sessionType: "Whole day" as const,
    attended,
    timeIn: null as string | null,
    timeOut: null as string | null,
    amTimeIn: sqlTimeTo12Hour(row.am_time_in),
    amTimeOut: sqlTimeTo12Hour(row.am_time_out),
    pmTimeIn: sqlTimeTo12Hour(row.pm_time_in),
    pmTimeOut: sqlTimeTo12Hour(row.pm_time_out),
    finePhp,
    paymentStatus,
  };
}

export class PublicStudentAttendanceController {
  lookup = async (req: Request, res: Response): Promise<void> => {
    try {
      const identifier = String(req.query.identifier ?? req.query.q ?? "").trim();
      if (!identifier) {
        res.status(400).json({ message: "Student ID or RFID is required." });
        return;
      }

      const resolved = await resolveStudentByIdentifier(identifier);
      if (!resolved) {
        res.status(404).json({ message: "Student not found." });
        return;
      }

      const profile = await findPublicStudentProfile(resolved.pk);
      if (!profile) {
        res.status(404).json({ message: "Student not found." });
        return;
      }

      const rawHistory = await findPublicAttendanceHistory(resolved.pk);
      const events = rawHistory.map(mapHistoryRow);
      const attended = events.filter((e) => e.attended).length;
      const missed = events.length - attended;

      res.status(200).json({
        student: {
          studentId: profile.student_id,
          name: profile.full_name || profile.student_id,
          yearLevel: profile.year_level,
          department: profile.department_name,
          course: profile.course_code,
        },
        summary: {
          totalEvents: events.length,
          attended,
          missed,
          attendanceRate: events.length > 0 ? Math.round((attended / events.length) * 100) : 0,
        },
        events,
      });
    } catch (error) {
      console.error("[PublicStudentAttendanceController.lookup]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };
}
