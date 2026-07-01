import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import { pool } from "../config/db";
import { Role } from "../types/express";
import {
  findStudentsWithAttendanceStats,
  findCompletedEventsForStudent,
  findStudentEnrollmentContext,
  resolveStudentPkByPublicId,
  EventHistoryDbRow,
} from "../repositories/student-dashboard.repository";
import { programToCourseFilterValue } from "../utils/programCourseFilter";
import { sqlTimeTo12Hour } from "../utils/sqlTime";

export interface DashboardStudentListItem {
  id: string;
  name: string;
  course: string;
  department: string | null;
  yearLevel: number | null;
  attendanceRate: number;
  totalEvents: number;
  eventsAttended: number;
  eventsMissed: number;
}

export interface DashboardEventHistoryItem {
  name: string;
  date: string;
  sessionType: "Whole day" | "AM Only" | "PM Only";
  attended: boolean;
  amTimeIn?: string | null;
  amTimeOut?: string | null;
  pmTimeIn?: string | null;
  pmTimeOut?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  finePhp: number;
}

export interface DashboardStudentDetail extends DashboardStudentListItem {
  participationTrend: "Increasing" | "Decreasing";
  streak: number;
  lastAttendedEvent: { name: string; date: string } | null;
  lastMissedEvent: { name: string; date: string } | null;
  mostMissedEventType: string;
  eventHistory: DashboardEventHistoryItem[];
  eventTypeBreakdown: { type: string; rate: number }[];
  alerts: { tone: "success" | "warning" | "info" | "danger"; text: string }[];
}

export class StudentDashboardController {
  private durationToSessionType(d: string): "Whole day" | "AM Only" | "PM Only" {
    if (d === "Whole Day") return "Whole day";
    if (d === "AM Only") return "AM Only";
    if (d === "PM Only") return "PM Only";
    // Backward compatibility for any legacy DB value.
    return "AM Only";
  }

  private mapHistoryRow(row: EventHistoryDbRow): DashboardEventHistoryItem {
    const sessionType = this.durationToSessionType(row.duration);
    const attended = row.attended === 1;
    const finePhp = row.fine_php != null ? Number(row.fine_php) : 0;

    if (sessionType !== "Whole day") {
      const hasAmData = row.am_time_in != null || row.am_time_out != null;
      const hasPmData = row.pm_time_in != null || row.pm_time_out != null;
      let useAm = sessionType === "AM Only";
      // If the expected side is empty but the other side has data, fallback so
      // "Attended" rows do not show all "No record" times in history.
      if (useAm && !hasAmData && hasPmData) useAm = false;
      if (!useAm && !hasPmData && hasAmData) useAm = true;
      const ti = useAm ? row.am_time_in : row.pm_time_in;
      const to = useAm ? row.am_time_out : row.pm_time_out;
      return {
        name: row.name,
        date: row.date,
        sessionType,
        attended,
        timeIn: sqlTimeTo12Hour(ti),
        timeOut: sqlTimeTo12Hour(to),
        finePhp,
      };
    }

    return {
      name: row.name,
      date: row.date,
      sessionType: "Whole day",
      attended,
      amTimeIn: sqlTimeTo12Hour(row.am_time_in),
      amTimeOut: sqlTimeTo12Hour(row.am_time_out),
      pmTimeIn: sqlTimeTo12Hour(row.pm_time_in),
      pmTimeOut: sqlTimeTo12Hour(row.pm_time_out),
      finePhp,
    };
  }

  private computeStreakAndTrend(history: DashboardEventHistoryItem[]): {
    streak: number;
    trend: "Increasing" | "Decreasing";
  } {
    const sorted = [...history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    let streak = 0;
    for (const ev of sorted) {
      if (ev.attended) streak += 1;
      else break;
    }
    const mid = Math.floor(sorted.length / 2);
    const recent = sorted.slice(0, mid || 1);
    const older = sorted.slice(mid || 1);
    const rate = (arr: DashboardEventHistoryItem[]) => {
      if (!arr.length) return 0;
      const ok = arr.filter((e) => e.attended).length;
      return ok / arr.length;
    };
    const trend = rate(recent) >= rate(older) ? "Increasing" : "Decreasing";
    return { streak, trend };
  }

  private buildAlerts(rate: number, missed: number): DashboardStudentDetail["alerts"] {
    const alerts: DashboardStudentDetail["alerts"] = [];
    if (rate < 85) {
      alerts.push({
        tone: "warning",
        text: "⚠️ Attendance below required threshold (need 85% for officers).",
      });
    }
    if (missed >= 2) {
      alerts.push({ tone: "info", text: `❗ ${missed} event(s) missed in recorded history.` });
    }
    return alerts;
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const userId = req.user?.id;
      const departmentId = req.user?.department_id ?? null;
      if (!role) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      // Admins and super admins see institution-wide stats; governors and CSG president only see stats for events they created.
      const isAdminFullAccess = role === "admin" || role === "super_admin";

      const adminStyleDepartmentBypass: Role[] = ["admin", "super_admin", "csg_president"];
      if (!adminStyleDepartmentBypass.includes(role) && (departmentId == null || departmentId === undefined)) {
        res.status(200).json({ students: [] });
        return;
      }
      const departmentFilter = adminStyleDepartmentBypass.includes(role) ? null : departmentId!;

      if (!isAdminFullAccess && userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const createdByFilter = isAdminFullAccess ? null : userId!;
      const rows = await findStudentsWithAttendanceStats(departmentFilter, createdByFilter);
      const students = rows.map((r) => {
        const total = Number(r.total_events) || 0;
        const att = Number(r.events_attended) || 0;
        const missed = Math.max(0, total - att);
        const rate = total > 0 ? Math.round((att / total) * 100) : 0;
        const ylParsed = Number(r.year_level);
        const yearLevel = Number.isFinite(ylParsed) ? ylParsed : null;
        return {
          id: r.student_id,
          name: r.full_name,
          course: programToCourseFilterValue(r.course_code, r.major),
          department: r.department_name?.trim() || null,
          yearLevel,
          attendanceRate: rate,
          totalEvents: total,
          eventsAttended: att,
          eventsMissed: missed,
        };
      });

      res.status(200).json({ students });
    } catch (error) {
      console.error("[StudentDashboardController.list]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }

  async detail(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role as Role | undefined;
      const userId = req.user?.id;
      const departmentId = req.user?.department_id ?? null;
      const isAdminFullAccess = role === "admin" || role === "super_admin";

      if (!role) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      if (!isAdminFullAccess && userId == null) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const createdByFilter = isAdminFullAccess ? null : userId!;

      const studentId = String(req.params.studentId ?? "").trim();
      if (!studentId) {
        res.status(400).json({ message: "studentId is required." });
        return;
      }

      const pk = await resolveStudentPkByPublicId(studentId);
      if (pk == null) {
        res.status(404).json({ message: "Student not found or access denied." });
        return;
      }

      const ctx = await findStudentEnrollmentContext(pk);
      if (!ctx) {
        res.status(404).json({ message: "Student not found or access denied." });
        return;
      }

      const adminStyleDepartmentBypass: Role[] = ["admin", "super_admin", "csg_president"];
      if (!adminStyleDepartmentBypass.includes(role) && ctx.program_id > 0) {
        const [progRows] = await pool.execute<RowDataPacket[]>(
          `SELECT department_id FROM programs WHERE id = ? LIMIT 1`,
          [ctx.program_id],
        );
        const depId = progRows[0] ? Number((progRows[0] as { department_id: number }).department_id) : null;
        if (depId == null || depId !== departmentId) {
          res.status(404).json({ message: "Student not found or access denied." });
          return;
        }
      }

      const rawHistory = await findCompletedEventsForStudent(
        pk,
        ctx.program_id,
        ctx.year_level,
        createdByFilter,
      );
      const eventHistory = rawHistory.map((row) => this.mapHistoryRow(row));

      const total = eventHistory.length;
      const attended = eventHistory.filter((e) => e.attended).length;
      const missed = total - attended;
      const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

      const { streak, trend } = this.computeStreakAndTrend(eventHistory);

      const sorted = [...eventHistory].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const lastAtt = sorted.find((e) => e.attended);
      const lastMiss = sorted.find((e) => !e.attended);

      const displayName = ctx.full_name?.trim() || studentId;

      const ylDetail = Number(ctx.year_level);
      const yearLevelDetail = Number.isFinite(ylDetail) ? ylDetail : null;

      const detail: DashboardStudentDetail = {
        id: studentId,
        name: displayName,
        course: programToCourseFilterValue(ctx.course_code, ctx.major),
        department: ctx.department_name,
        yearLevel: yearLevelDetail,
        attendanceRate: rate,
        totalEvents: total,
        eventsAttended: attended,
        eventsMissed: missed,
        participationTrend: trend,
        streak,
        lastAttendedEvent: lastAtt ? { name: lastAtt.name, date: lastAtt.date } : null,
        lastMissedEvent: lastMiss ? { name: lastMiss.name, date: lastMiss.date } : null,
        mostMissedEventType: "—",
        eventHistory,
        eventTypeBreakdown: [],
        alerts: this.buildAlerts(rate, missed),
      };

      res.status(200).json(detail);
    } catch (error) {
      console.error("[StudentDashboardController.detail]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}
