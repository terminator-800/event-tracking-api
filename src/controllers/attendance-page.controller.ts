import { Request, Response } from "express";
import { sqlTimeTo12Hour } from "../utils/sqlTime";
import { toYmdDateString } from "../utils/sqlDate";
import { Role } from "../types/express";
import {
  ADMIN_ROLES,
  AttendanceRosterDepartmentScope,
  countAttendedStudents,
  countEligibleStudents,
  getUserDepartmentIdForAttendance,
  selectScopedEvents,
  selectStudentsForEventDetail,
  ScopedEventRow,
  userCanAccessEvent,
} from "../repositories/attendance-page.repository";

/** Roster scope: JWT department when present (dept homepage login), otherwise DB user row — matches scoped event queries. */
async function resolveAttendanceDepartmentScope(
  role: Role,
  userId: number,
  jwtDepartmentId: number | null | undefined,
): Promise<AttendanceRosterDepartmentScope> {
  if (ADMIN_ROLES.includes(role)) return null;
  if (jwtDepartmentId != null && Number.isFinite(Number(jwtDepartmentId))) {
    return Number(jwtDepartmentId);
  }
  return getUserDepartmentIdForAttendance(userId);
}

function mapStatus(db: string): "upcoming" | "ongoing" | "completed" | "cancelled" {
  const s = String(db || "").toLowerCase();
  if (s === "upcoming") return "upcoming";
  if (s === "ongoing") return "ongoing";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "upcoming";
}

function durationToSessionType(row: ScopedEventRow): "whole_day" | "am" | "pm" {
  const d = row.duration;
  if (d === "Whole Day") return "whole_day";
  if (d === "AM Only") return "am";
  if (d === "PM Only") return "pm";
  if (d === "Half Day") {
    if (row.am_time_in && !row.pm_time_in) return "am";
    if (!row.am_time_in && row.pm_time_in) return "pm";
    return "whole_day";
  }
  return "whole_day";
}

async function buildSummaryPayload(
  rows: ScopedEventRow[],
  scopeDepartmentId: AttendanceRosterDepartmentScope,
) {
  const out = [];
  for (const e of rows) {
    const total = await countEligibleStudents(e.id, scopeDepartmentId);
    const attended = await countAttendedStudents(e.id, e.duration, scopeDepartmentId);
    const st = mapStatus(e.status);
    let absent = 0;
    if (st === "upcoming") {
      absent = 0;
    } else {
      absent = Math.max(0, total - attended);
    }
    out.push({
      id: String(e.id),
      name: e.name,
      date: toYmdDateString(e.date),
      status: st,
      sessionType: durationToSessionType(e),
      totalStudents: total,
      attended: st === "upcoming" ? 0 : attended,
      absent,
      finePerAbsence: Number(e.fine_amount ?? 0),
      venue: e.venue,
      duration: e.duration,
      audiences: e.audiences,
      isAllDepartments: Number(e.is_all_departments) === 1,
    });
  }
  return { events: out, generatedAt: new Date().toISOString() };
}

function studentAttended(_duration: string, row: {
  am_time_in: string | null;
  am_time_out: string | null;
  pm_time_in: string | null;
  pm_time_out: string | null;
}): boolean {
  // Attendance list rule: any attendance record in any slot counts as attended.
  return (
    row.am_time_in != null ||
    row.am_time_out != null ||
    row.pm_time_in != null ||
    row.pm_time_out != null
  );
}

export class AttendancePageController {
  list = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId || !userRole) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    try {
      const scopeDept = await resolveAttendanceDepartmentScope(
        userRole,
        userId,
        req.user?.department_id,
      );
      const rows = await selectScopedEvents(userRole, userId);
      const payload = await buildSummaryPayload(rows, scopeDept);
      res.status(200).json(payload);
    } catch (err) {
      console.error("[AttendancePageController.list]", err);
      res.status(500).json({ message: "Internal server error." });
    }
  };

  detail = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId || !userRole) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId)) {
      res.status(400).json({ message: "Invalid event id." });
      return;
    }
    try {
      const scopeDept = await resolveAttendanceDepartmentScope(
        userRole,
        userId,
        req.user?.department_id,
      );
      const rows = await selectScopedEvents(userRole, userId);
      const eventRow = rows.find((r) => r.id === eventId);
      if (!eventRow) {
        res.status(404).json({ message: "Event not found." });
        return;
      }
      if (!userCanAccessEvent(eventRow, userRole, scopeDept ?? null)) {
        res.status(403).json({ message: "Forbidden." });
        return;
      }

      const total = await countEligibleStudents(eventId, scopeDept);
      const attendedCount = await countAttendedStudents(eventId, eventRow.duration, scopeDept);
      const st = mapStatus(eventRow.status);
      const absent = st === "upcoming" ? 0 : Math.max(0, total - attendedCount);

      const studentRows = await selectStudentsForEventDetail(eventId, scopeDept);
      const timeInOnly =
        String(eventRow.event_mode ?? "").trim().toUpperCase() === "TIME_IN_ONLY";
      const students = studentRows.map((s) => {
        const ok = studentAttended(eventRow.duration, s);
        const fine = Number(s.fine_total ?? 0);
        const amIn = sqlTimeTo12Hour(s.am_time_in);
        const amOut = timeInOnly ? null : sqlTimeTo12Hour(s.am_time_out);
        const pmIn = sqlTimeTo12Hour(s.pm_time_in);
        const pmOut = timeInOnly ? null : sqlTimeTo12Hour(s.pm_time_out);
        const ylRaw = s.year_level;
        const yearLevelParsed =
          ylRaw != null && ylRaw !== "" && Number.isFinite(Number(ylRaw)) ? Number(ylRaw) : null;
        return {
          id: String(s.student_id),
          name: s.full_name,
          course: s.course_code,
          major:
            s.major != null && String(s.major).trim() !== "" ? String(s.major).trim() : null,
          department: s.department_name?.trim() || null,
          yearLevel: yearLevelParsed,
          status: ok ? "attended" : "absent",
          finePhp: fine,
          fromServer: true,
          penalty: fine,
          amIn: amIn ?? "No record",
          amOut: timeInOnly ? "—" : amOut ?? "No record",
          pmIn: pmIn ?? "No record",
          pmOut: timeInOnly ? "—" : pmOut ?? "No record",
        };
      });

      res.status(200).json({
        event: {
          id: String(eventRow.id),
          name: eventRow.name,
          date: toYmdDateString(eventRow.date),
          status: st,
          sessionType: durationToSessionType(eventRow),
          totalStudents: total,
          attended: st === "upcoming" ? 0 : attendedCount,
          absent,
          finePerAbsence: Number(eventRow.fine_amount ?? 0),
          venue: eventRow.venue,
          duration: eventRow.duration,
          event_mode: timeInOnly ? "TIME_IN_ONLY" : "TIME_IN_OUT",
          time_in_only: timeInOnly,
          audiences: eventRow.audiences,
          isAllDepartments: Number(eventRow.is_all_departments) === 1,
          am_time_in: eventRow.am_time_in,
          am_time_out: eventRow.am_time_out,
          pm_time_in: eventRow.pm_time_in,
          pm_time_out: eventRow.pm_time_out,
          am_grace_in: Number(eventRow.am_grace_in ?? 0),
          am_grace_out: Number(eventRow.am_grace_out ?? 0),
          pm_grace_in: Number(eventRow.pm_grace_in ?? 0),
          pm_grace_out: Number(eventRow.pm_grace_out ?? 0),
          audience_notes: eventRow.audience_notes != null ? String(eventRow.audience_notes) : null,
          students,
        },
      });
    } catch (err) {
      console.error("[AttendancePageController.detail]", err);
      res.status(500).json({ message: "Internal server error." });
    }
  };

  /** Server-Sent Events: periodic JSON snapshots of the same payload as `list`. */
  stream = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId || !userRole) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = async () => {
      try {
        const scopeDept = await resolveAttendanceDepartmentScope(
          userRole,
          userId,
          req.user?.department_id,
        );
        const rows = await selectScopedEvents(userRole, userId);
        const payload = await buildSummaryPayload(rows, scopeDept);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        console.error("[AttendancePageController.stream]", err);
        res.write(`event: error\ndata: ${JSON.stringify({ message: "snapshot failed" })}\n\n`);
      }
    };

    await send();
    const interval = setInterval(send, 8000);

    req.on("close", () => {
      clearInterval(interval);
    });
  };
}
