import { Request, Response } from "express";
import { pool } from "../config/db";
import { getActiveAcademicPeriod } from "./services/academic-period.service";
import { sqlActivePeriodEventsClause } from "../utils/studentEligibilitySql";
import { ResultSetHeader } from "mysql2";
import { Role } from "../types/express";
import {
  MIN_EVENT_PASSWORD_LENGTH,
  parseAttendancePasswordFromBody,
  prepareEventPasswordStorage,
  revealStoredPassword,
} from "./services/event-password.service";
import { sanitizeEventRow, sanitizeEventRows } from "../utils/eventResponse";
import { newEventUuid } from "../models/events.model";
import {
  ALL_GOVERNOR_ROLE_VALUES,
  isCsgCashierRole,
  isGovernorRole,
  SQL_CSG_PRESIDENT_CREATOR,
} from "../utils/roles";

/** Frontend sends this when a governor picks "All Majors" for CEAS — audience = every program in that department. */
const CEAS_GOVERNOR_ALL_PROGRAMS_SENTINEL = "__CEAS_GOVERNOR_ALL_PROGRAMS__";

/** Frontend sends this when a governor picks "All Majors" for CBA — audience = whole BSBA cohort (department scope). */
const CBA_GOVERNOR_ALL_BSBA_SENTINEL = "__CBA_GOVERNOR_ALL_BSBA__";

type EventMode = "TIME_IN_OUT" | "TIME_IN_ONLY";

interface CreateEventBody {
  name: string;
  date: string;
  venue: string;
  duration: "Whole Day" | "Half Day" | "AM Only" | "PM Only";
  /** Preferred: TIME_IN_OUT | TIME_IN_ONLY */
  event_mode?: EventMode;
  /** Alternate boolean flags from older/alternate clients */
  time_in_only?: boolean;
  timeInOnly?: boolean;
  amTimeIn?: string;
  amTimeOut?: string;
  pmTimeIn?: string;
  pmTimeOut?: string;
  am_grace_in: number;  
  am_grace_out: number;  
  pm_grace_in: number;   
  pm_grace_out: number;  
  isMandatory: boolean;
  status: "Upcoming" | "Ongoing" | "Completed" | "Cancelled";
  audienceNotes?: string;
  course_code: string;
  programId?: number;
  yearLevel?: string;
  major?: string;
  fineAmount: number;
}

interface EventAudienceInsertRow {
  departmentId: number;
  programId: number | null;
  yearLevel: number | null;
}

interface UpdateEventBody {
  name: string;
  date: string;
  venue: string;
  duration: "Whole Day" | "Half Day" | "AM Only" | "PM Only";
  event_mode?: EventMode;
  time_in_only?: boolean;
  timeInOnly?: boolean;
  am_time_in?: string | null;
  am_time_out?: string | null;
  pm_time_in?: string | null;
  pm_time_out?: string | null;
  am_grace_in?: number;
  pm_grace_in?: number;
  audience_notes?: string | null;
  fine_amount?: number;
}

export class EventController {

private parseYearLevel(yearLevel: string | null | undefined): number | null {
  if (!yearLevel || yearLevel === "All Year Levels") return null;
  const match = yearLevel.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}
  
private parseMajor(major: string | null | undefined): string | null {
  if (!major || major === "All Majors") return null;
  return major;
}

private to24Hour(time: string | null | undefined): string | null {
  if (!time) return null;

  const [timePart, meridiem] = time.trim().split(" ");
  let [h, m] = timePart.split(":").map(Number);

  if (meridiem?.toUpperCase() === "PM" && h !== 12) h += 12;
  if (meridiem?.toUpperCase() === "AM" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

private resolveGracePeriod(value: number | null | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}

private normalizeTimeInput(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  const sql = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (sql) {
    const h = Number(sql[1]);
    const m = Number(sql[2]);
    const sec = sql[3] != null ? Number(sql[3]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return this.to24Hour(s);
}

private resolveTimings(body: CreateEventBody) {
  return {
    amIn:      this.to24Hour(body.amTimeIn),
    amOut:     this.to24Hour(body.amTimeOut),
    pmIn:      this.to24Hour(body.pmTimeIn),
    pmOut:     this.to24Hour(body.pmTimeOut),
    graceAmIn:  this.resolveGracePeriod(body.am_grace_in),
    graceAmOut: this.resolveGracePeriod(body.am_grace_out),
    gracePmIn:  this.resolveGracePeriod(body.pm_grace_in),
    gracePmOut: this.resolveGracePeriod(body.pm_grace_out),
  };
}

private resolveEventMode(body: {
  event_mode?: unknown;
  time_in_only?: unknown;
  timeInOnly?: unknown;
}): EventMode {
  const mode = String(body.event_mode ?? "").trim().toUpperCase();
  if (mode === "TIME_IN_ONLY") return "TIME_IN_ONLY";
  if (mode === "TIME_IN_OUT") return "TIME_IN_OUT";
  if (body.time_in_only === true || body.time_in_only === 1 || body.time_in_only === "1") {
    return "TIME_IN_ONLY";
  }
  if (body.timeInOnly === true || body.timeInOnly === 1 || body.timeInOnly === "1") {
    return "TIME_IN_ONLY";
  }
  return "TIME_IN_OUT";
}

async createEvent(req: Request, res: Response): Promise<void> {
  const createdBy: number = req.user?.id!;

  if (!createdBy) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userRole = req.user?.role;
  const userDepartmentId = req.user?.department_id ?? null;

  const {
    name,
    date,
    venue,
    duration,
    isMandatory,
    status,
    audienceNotes,
    course_code,
    programId,
    yearLevel,
    fineAmount,
    major,
  }: CreateEventBody = req.body;

  if (!name || !date || !venue || !duration || !status) {
    res.status(400).json({ message: "Missing required fields." });
    return;
  }

  const attendancePassword = parseAttendancePasswordFromBody(req.body);
  if (attendancePassword.length < MIN_EVENT_PASSWORD_LENGTH) {
    res.status(400).json({
      message: `Event password is required and must be at least ${MIN_EVENT_PASSWORD_LENGTH} characters.`,
    });
    return;
  }
  const { hash: attendancePasswordHash, encrypted: attendancePasswordEncrypted } =
    await prepareEventPasswordStorage(attendancePassword);

  const isAllDepartments = course_code === "All Departments";

  if (userRole !== "admin" && userRole !== "super_admin" && userRole !== "csg_president") {
    if (isAllDepartments) {
      res.status(403).json({ message: "Access denied for creating all-departments events." });
      return;
    }
    if (!userDepartmentId) {
      res.status(403).json({ message: "Access denied: user has no associated department." });
      return;
    }
  }

  const { amIn, amOut, pmIn, pmOut, graceAmIn, graceAmOut, gracePmIn, gracePmOut } = this.resolveTimings(req.body);
  const eventMode = this.resolveEventMode(req.body);

  let audiencesToInsert: EventAudienceInsertRow[] = [];
  let resolvedDepartmentId: number | null = null;

  if (!isAllDepartments) {
    const courseKey = String(course_code ?? "").trim().toUpperCase();
    const parsedYearLevel = this.parseYearLevel(yearLevel);

    if (
      courseKey === CEAS_GOVERNOR_ALL_PROGRAMS_SENTINEL &&
      isGovernorRole(userRole) &&
      userDepartmentId != null &&
      Number.isFinite(Number(userDepartmentId))
    ) {
      resolvedDepartmentId = Number(userDepartmentId);
      audiencesToInsert = [{ departmentId: resolvedDepartmentId, programId: null, yearLevel: parsedYearLevel }];
    } else if (
      courseKey === CBA_GOVERNOR_ALL_BSBA_SENTINEL &&
      isGovernorRole(userRole) &&
      userDepartmentId != null &&
      Number.isFinite(Number(userDepartmentId))
    ) {
      resolvedDepartmentId = Number(userDepartmentId);
      audiencesToInsert = [{ departmentId: resolvedDepartmentId, programId: null, yearLevel: parsedYearLevel }];
    } else {
      const parsedMajor = this.parseMajor(major);
      const governorDeptId =
        userDepartmentId != null && Number.isFinite(Number(userDepartmentId))
          ? Number(userDepartmentId)
          : null;
      const isGovernor = isGovernorRole(userRole);

      let programRow: { id: number; department_id: number } | null = null;

      if (governorDeptId != null) {
        const [scopedRows]: any = await pool.execute(
          `SELECT id, department_id FROM programs
           WHERE department_id = ? AND UPPER(TRIM(course_code)) = ?
           LIMIT 1`,
          [governorDeptId, courseKey],
        );
        if (scopedRows.length) programRow = scopedRows[0];
      }

      if (!programRow) {
        const [anyRows]: any = await pool.execute(
          `SELECT id, department_id FROM programs WHERE UPPER(TRIM(course_code)) = ? LIMIT 1`,
          [courseKey],
        );
        if (anyRows.length) programRow = anyRows[0];
      }

      if (!programRow) {
        if (isGovernor && governorDeptId != null && parsedMajor === null) {
          resolvedDepartmentId = governorDeptId;
          audiencesToInsert = [
            { departmentId: governorDeptId, programId: null, yearLevel: parsedYearLevel },
          ];
        } else {
          res.status(400).json({ message: "Program not found." });
          return;
        }
      } else {
      const deptId = Number(programRow.department_id);
      resolvedDepartmentId = deptId;

      if (parsedMajor !== null) {
        const majorsOrdered: string[] = [parsedMajor];
        const ml = String(parsedMajor).trim().toLowerCase();
        if (courseKey === "BSBA" && ml.includes("human resource")) {
          majorsOrdered.push(
            "Human Resource Development Management",
            "Human Resource Management",
            "HRDM",
          );
        }
        if (courseKey === "BSBA" && ml === "financial management") {
          majorsOrdered.push("FM");
        }
        if (courseKey === "BSBA" && ml === "marketing management") {
          majorsOrdered.push("MM");
        }
        let programIdResolved: number | null = null;
        const tried = new Set<string>();
        for (const cand of majorsOrdered) {
          const key = cand.trim().toLowerCase();
          if (tried.has(key)) continue;
          tried.add(key);
          const [programRows]: any = await pool.execute(
            `SELECT id FROM programs
             WHERE department_id = ?
               AND UPPER(TRIM(course_code)) = UPPER(TRIM(?))
               AND LOWER(TRIM(COALESCE(major, ''))) = LOWER(TRIM(?))
             LIMIT 1`,
            [deptId, courseKey, cand],
          );
          if (programRows.length) {
            programIdResolved = Number(programRows[0].id);
            break;
          }
        }
        if (programIdResolved == null) {
          res.status(400).json({ message: "Program not found." });
          return;
        }
        audiencesToInsert = [
          {
            departmentId: deptId,
            programId: programIdResolved,
            yearLevel: parsedYearLevel,
          },
        ];
      } else if (courseKey === "BSED") {
        const [bsedPrograms]: any = await pool.execute(
          `SELECT id FROM programs WHERE department_id = ? AND UPPER(TRIM(course_code)) = 'BSED' ORDER BY id ASC`,
          [deptId],
        );
        if (!bsedPrograms.length) {
          res.status(400).json({ message: "Program not found." });
          return;
        }
        audiencesToInsert = bsedPrograms.map((r: { id: number }) => ({
          departmentId: deptId,
          programId: Number(r.id),
          yearLevel: parsedYearLevel,
        }));
      } else {
        const programId = Number(programRow.id);
        audiencesToInsert = [
          { departmentId: deptId, programId, yearLevel: parsedYearLevel },
        ];
      }
      }
    }

    if (userRole !== "admin" && userRole !== "super_admin" && userRole !== "csg_president") {
      if (!resolvedDepartmentId || resolvedDepartmentId !== userDepartmentId) {
        res.status(403).json({ message: "Access denied for creating events outside your department." });
        return;
      }
    }
  }

  const connection = await pool.getConnection();
  const academicPeriodId = req.activeAcademicPeriod?.id ?? null;
  if (academicPeriodId == null) {
    res.status(403).json({
      message:
        "No active school year and semester. Activate an academic period before creating events.",
    });
    return;
  }

  try {
    await connection.beginTransaction();

    const eventUuid = newEventUuid();
    // Master events point master_event_uuid at themselves for stable CSG↔governor linking.
    const masterEventUuid = eventUuid;

    const [eventResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO events (
        event_uuid, event_version, master_event_uuid,
        name, date, venue, duration, event_mode,
        am_time_in, am_grace_in, am_time_out, am_grace_out,
        pm_time_in, pm_grace_in, pm_time_out, pm_grace_out,
        is_mandatory, is_all_departments,
        status, audience_notes, fine_amount, attendance_password_hash, attendance_password_encrypted, created_by, academic_period_id
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventUuid,
        masterEventUuid,
        name, date, venue, duration, eventMode,
        amIn,  graceAmIn,  amOut, graceAmOut,
        pmIn,  gracePmIn,  pmOut, gracePmOut,
        isMandatory ? 1 : 0,
        isAllDepartments ? 1 : 0,
        status,
        audienceNotes || null,
        fineAmount ?? 0,
        attendancePasswordHash,
        attendancePasswordEncrypted,
        createdBy,
        academicPeriodId,
      ]
    );

    const eventId = eventResult.insertId;

    if (!isAllDepartments) {
      if (!resolvedDepartmentId || audiencesToInsert.length === 0) {
        await connection.rollback();
        res.status(400).json({ message: "Invalid resolved department/program." });
        return;
      }

      for (const row of audiencesToInsert) {
        await connection.execute(
          `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
          VALUES (?, ?, ?, ?)`,
          [eventId, row.departmentId, row.programId, row.yearLevel],
        );
      }
    } else {
      const parsedYearLevel = this.parseYearLevel(yearLevel);
      if (parsedYearLevel !== null) {
        await connection.execute(
          `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
            VALUES (?, ?, ?, ?)`,
          [eventId, null, null, parsedYearLevel]
        );
      }
    }

    await connection.commit();
    console.log("committed");

    res.status(201).json({ message: "Event created successfully.", eventId });
  } catch (error) {
    await connection.rollback();
    console.error("[createEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  } finally {
    connection.release();
  }
}

async updateEvent(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userDepartmentId = req.user?.department_id ?? null;

  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    res.status(400).json({ message: "Invalid event id." });
    return;
  }

  const body: UpdateEventBody = req.body;
  const name = String(body.name ?? "").trim();
  const date = String(body.date ?? "").trim();
  const venue = String(body.venue ?? "").trim();
  const duration = String(body.duration ?? "").trim() as UpdateEventBody["duration"];
  const allowedDurations = new Set(["Whole Day", "Half Day", "AM Only", "PM Only"]);

  if (!name || !date || !venue || !duration || !allowedDurations.has(duration)) {
    res.status(400).json({ message: "Missing or invalid required fields." });
    return;
  }

  try {
    const [rows]: any = await pool.execute(
      `SELECT 
        e.id, e.status, e.is_all_departments,
        MAX(ea.department_id) AS department_id
       FROM events e
       LEFT JOIN event_audiences ea ON ea.event_id = e.id
       WHERE e.id = ?
       GROUP BY e.id`,
      [eventId]
    );

    if (!rows.length) {
      res.status(404).json({ message: "Event not found." });
      return;
    }

    const event = rows[0];
    const statusKey = String(event.status ?? "").trim().toLowerCase();
    if (statusKey === "completed" || statusKey === "ongoing" || statusKey === "active") {
      res.status(403).json({ message: "Completed or ongoing events cannot be edited." });
      return;
    }

    const adminRoles: Role[] = ["admin", "super_admin", "csg_president"];
    if (!adminRoles.includes(userRole!)) {
      const isAllDepartments = Number(event.is_all_departments) === 1;
      if (!isAllDepartments) {
        if (!userDepartmentId || Number(event.department_id) !== Number(userDepartmentId)) {
          res.status(403).json({ message: "Access denied for editing this event." });
          return;
        }
      }
    }

    const amIn = this.normalizeTimeInput(body.am_time_in ?? null);
    const amOut = this.normalizeTimeInput(body.am_time_out ?? null);
    const pmIn = this.normalizeTimeInput(body.pm_time_in ?? null);
    const pmOut = this.normalizeTimeInput(body.pm_time_out ?? null);
    const graceAmIn = this.resolveGracePeriod(body.am_grace_in);
    const gracePmIn = this.resolveGracePeriod(body.pm_grace_in);
    const eventMode = this.resolveEventMode(body);
    const audienceNotes = body.audience_notes != null ? String(body.audience_notes) : null;
    const fineAmountRaw = body.fine_amount;
    const fineAmount = Number.isFinite(Number(fineAmountRaw)) ? Math.max(0, Number(fineAmountRaw)) : 0;

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE events
       SET
         name = ?,
         date = ?,
         venue = ?,
         duration = ?,
         event_mode = ?,
         am_time_in = ?,
         am_time_out = ?,
         pm_time_in = ?,
         pm_time_out = ?,
         am_grace_in = ?,
         pm_grace_in = ?,
         audience_notes = ?,
         fine_amount = ?
       WHERE id = ?`,
      [
        name,
        date,
        venue,
        duration,
        eventMode,
        amIn,
        amOut,
        pmIn,
        pmOut,
        graceAmIn,
        gracePmIn,
        audienceNotes,
        fineAmount,
        eventId,
      ]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Event not found." });
      return;
    }

    res.status(200).json({ message: "Event updated successfully.", eventId });
  } catch (error) {
    console.error("[updateEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}

/**
 * Narrow update for live events: change scheduled time-out only.
 * Lets staff end a session early so students can time out without waiting for the original end time.
 */
async updateEventTimeout(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userDepartmentId = req.user?.department_id ?? null;

  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    res.status(400).json({ message: "Invalid event id." });
    return;
  }

  const body = (req.body ?? {}) as {
    am_time_out?: string | null;
    pm_time_out?: string | null;
    amTimeOut?: string | null;
    pmTimeOut?: string | null;
  };

  const hasAmOut = Object.prototype.hasOwnProperty.call(body, "am_time_out")
    || Object.prototype.hasOwnProperty.call(body, "amTimeOut");
  const hasPmOut = Object.prototype.hasOwnProperty.call(body, "pm_time_out")
    || Object.prototype.hasOwnProperty.call(body, "pmTimeOut");

  if (!hasAmOut && !hasPmOut) {
    res.status(400).json({ message: "Provide am_time_out and/or pm_time_out." });
    return;
  }

  try {
    const [rows]: any = await pool.execute(
      `SELECT 
        e.id, e.status, e.is_all_departments,
        e.am_time_in, e.pm_time_in, e.am_time_out, e.pm_time_out,
        (SELECT MAX(ea.department_id) FROM event_audiences ea WHERE ea.event_id = e.id) AS department_id
       FROM events e
       WHERE e.id = ?`,
      [eventId]
    );

    if (!rows.length) {
      res.status(404).json({ message: "Event not found." });
      return;
    }

    const event = rows[0];
    const statusKey = String(event.status ?? "").trim().toLowerCase();
    if (statusKey === "completed") {
      res.status(403).json({ message: "Completed events cannot change time-out." });
      return;
    }
    if (statusKey !== "ongoing" && statusKey !== "active") {
      res.status(403).json({
        message: "Time-out can only be adjusted while the event is Ongoing. Edit the full schedule for Upcoming events.",
      });
      return;
    }

    const adminRoles: Role[] = ["admin", "super_admin", "csg_president"];
    if (!adminRoles.includes(userRole!)) {
      const isAllDepartments = Number(event.is_all_departments) === 1;
      if (!isAllDepartments) {
        if (!userDepartmentId || Number(event.department_id) !== Number(userDepartmentId)) {
          res.status(403).json({ message: "Access denied for editing this event." });
          return;
        }
      }
    }

    const nextAmOut = hasAmOut
      ? this.normalizeTimeInput(body.am_time_out ?? body.amTimeOut ?? null)
      : this.normalizeTimeInput(event.am_time_out);
    const nextPmOut = hasPmOut
      ? this.normalizeTimeInput(body.pm_time_out ?? body.pmTimeOut ?? null)
      : this.normalizeTimeInput(event.pm_time_out);

    const amIn = this.normalizeTimeInput(event.am_time_in);
    const pmIn = this.normalizeTimeInput(event.pm_time_in);

    if (nextAmOut && amIn && nextAmOut <= amIn) {
      res.status(400).json({ message: "AM time-out must be after AM time-in." });
      return;
    }
    if (nextPmOut && pmIn && nextPmOut <= pmIn) {
      res.status(400).json({ message: "PM time-out must be after PM time-in." });
      return;
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE events
       SET am_time_out = ?, pm_time_out = ?
       WHERE id = ?`,
      [nextAmOut, nextPmOut, eventId]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Event not found." });
      return;
    }

    res.status(200).json({
      message: "Event time-out updated successfully.",
      eventId,
      am_time_out: nextAmOut,
      pm_time_out: nextPmOut,
    });
  } catch (error) {
    console.error("[updateEventTimeout] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}

async deleteEvent(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userDepartmentId = req.user?.department_id ?? null;

  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    res.status(400).json({ message: "Invalid event id." });
    return;
  }

  const connection = await pool.getConnection();
  try {
    const [rows]: any = await connection.execute(
      `SELECT
        e.id, e.status, e.is_all_departments,
        MAX(ea.department_id) AS department_id
       FROM events e
       LEFT JOIN event_audiences ea ON ea.event_id = e.id
       WHERE e.id = ?
       GROUP BY e.id`,
      [eventId]
    );

    if (!rows.length) {
      res.status(404).json({ message: "Event not found." });
      return;
    }

    const event = rows[0];
    const statusKey = String(event.status ?? "").trim().toLowerCase();
    const isSuperAdmin = userRole === "super_admin";
    // Super admin may delete any event; other roles cannot delete ongoing/completed.
    if (
      !isSuperAdmin &&
      (statusKey === "completed" || statusKey === "ongoing" || statusKey === "active")
    ) {
      res.status(403).json({ message: "Completed or ongoing events cannot be deleted." });
      return;
    }

    const adminRoles: Role[] = ["admin", "super_admin", "csg_president"];
    if (!adminRoles.includes(userRole!)) {
      const isAllDepartments = Number(event.is_all_departments) === 1;
      if (!isAllDepartments) {
        if (!userDepartmentId || Number(event.department_id) !== Number(userDepartmentId)) {
          res.status(403).json({ message: "Access denied for deleting this event." });
          return;
        }
      }
    }

    await connection.beginTransaction();
    await connection.execute(`DELETE FROM event_audiences WHERE event_id = ?`, [eventId]);
    const [result] = await connection.execute<ResultSetHeader>(`DELETE FROM events WHERE id = ?`, [eventId]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      res.status(404).json({ message: "Event not found." });
      return;
    }
    await connection.commit();

    res.status(200).json({ message: "Event deleted successfully.", eventId });
  } catch (error) {
    await connection.rollback();
    console.error("[deleteEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  } finally {
    connection.release();
  }
}

async getEvents(req: Request, res: Response): Promise<void> {
const userId   = req.user?.id!;
const userRole = req.user?.role!;

if (!userId) {
  res.status(401).json({ message: "Unauthorized" });
  return;
}

  // `admin` and `super_admin` see every event cross-department. CSG presidents and governors only see events they created.
try {
  let events: any[] = [];
  const activePeriod = await getActiveAcademicPeriod();
  const periodClause = activePeriod
    ? sqlActivePeriodEventsClause("e")
    : " AND 1=0";
  const periodParams = activePeriod ? [activePeriod.id] : [];

  if (userRole === "admin" || userRole === "super_admin") {
    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'department_code', d.code,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'major',           NULLIF(TRIM(p.major), ''),
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE 1=1${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      periodParams,
    );
    events = rows;

  } else if (userRole === "csg_president") {
    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'department_code', d.code,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'major',           NULLIF(TRIM(p.major), ''),
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE e.created_by = ?${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      [userId, ...periodParams],
    );
    events = rows;

  } else if (isCsgCashierRole(userRole, req.user?.department_id)) {
    // Same event pool as CSG President desk: events created by CSG President accounts.
    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'department_code', d.code,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'major',           NULLIF(TRIM(p.major), ''),
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE ${SQL_CSG_PRESIDENT_CREATOR}${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      periodParams,
    );
    events = rows;

  } else {
    const [userRows]: any = await pool.execute(
      `SELECT department_id FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    if (!userRows.length || !userRows[0].department_id) {
      res.status(403).json({ message: "User has no associated department." });
      return;
    }

    const departmentId = userRows[0].department_id;
    // Governors: only their own events. Dept cashiers: college audience (any creator).
    const filterByCreator = isGovernorRole(userRole);
    const creatorSql = filterByCreator ? " AND e.created_by = ?" : "";
    const params: (number | string)[] = [departmentId, departmentId];
    if (filterByCreator) params.push(userId);
    params.push(...periodParams);

    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'department_code', d.code,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'major',           NULLIF(TRIM(p.major), ''),
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
        AND (e.is_all_departments = 1 OR ea.department_id = ?)
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE (e.is_all_departments = 1 OR ea.department_id = ?)
        ${creatorSql}${periodClause}
      GROUP BY e.id
      ORDER BY e.date DESC`,
      params,
    );
    events = rows;
  }

  // console.log("events:", events);
  console.log("Total events:", events.length);
  res.status(200).json({ events: sanitizeEventRows(events) });

} catch (error) {
  console.error("[getEvents] Error:", error);
  res.status(500).json({ message: "Internal server error." });
}
}

async getCurrentEvent(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const departmentId = req.user?.department_id ?? null;
    const role = req.user?.role ?? null;
    const activePeriod = await getActiveAcademicPeriod();
    const periodClause = activePeriod ? sqlActivePeriodEventsClause("e") : " AND 1=0";
    const periodParams = activePeriod ? [activePeriod.id] : [];

    console.log("[getCurrentEvent] user:", { role, departmentId, activePeriodId: activePeriod?.id ?? null });

    // Admin / super_admin: every upcoming & ongoing event (all creators / departments).
    if (role === "admin" || role === "super_admin") {
      const [rows]: any = await pool.execute(
        `SELECT
          e.*,
          u.username AS created_by_username,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'department_id',   ea.department_id,
              'department_name', d.name,
              'department_code', d.code,
              'program_id',      ea.program_id,
              'course_code',     p.course_code,
              'course_name',     p.course_name,
              'major',           NULLIF(TRIM(p.major), ''),
              'year_level',      ea.year_level
            )
          ) AS audiences
        FROM events e
        LEFT JOIN users u            ON u.id  = e.created_by
        LEFT JOIN event_audiences ea ON ea.event_id = e.id
        LEFT JOIN departments d      ON d.id = ea.department_id
        LEFT JOIN programs p         ON p.id = ea.program_id
        WHERE e.status IN ('Upcoming', 'Ongoing')
        ${periodClause}
        GROUP BY e.id
        ORDER BY e.date ASC`,
        periodParams,
      );
      res.status(200).json({ events: sanitizeEventRows(rows) });
      return;
    }

    if (role === "csg_president" && userId) {
      const [rows]: any = await pool.execute(
        `SELECT
          e.*,
          u.username AS created_by_username,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'department_id',   ea.department_id,
              'department_name', d.name,
              'department_code', d.code,
              'program_id',      ea.program_id,
              'course_code',     p.course_code,
              'course_name',     p.course_name,
              'major',           NULLIF(TRIM(p.major), ''),
              'year_level',      ea.year_level
            )
          ) AS audiences
        FROM events e
        LEFT JOIN users u            ON u.id  = e.created_by
        LEFT JOIN event_audiences ea ON ea.event_id = e.id
        LEFT JOIN departments d      ON d.id = ea.department_id
        LEFT JOIN programs p         ON p.id = ea.program_id
        WHERE e.created_by = ?
        AND e.status IN ('Upcoming', 'Ongoing')
        ${periodClause}
        GROUP BY e.id
        ORDER BY e.date ASC`,
        [userId, ...periodParams]
      );
      res.status(200).json({ events: sanitizeEventRows(rows) });
      return;
    }

    if (isCsgCashierRole(role, departmentId)) {
      const [rows]: any = await pool.execute(
        `SELECT
          e.*,
          u.username AS created_by_username,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'department_id',   ea.department_id,
              'department_name', d.name,
              'department_code', d.code,
              'program_id',      ea.program_id,
              'course_code',     p.course_code,
              'course_name',     p.course_name,
              'major',           NULLIF(TRIM(p.major), ''),
              'year_level',      ea.year_level
            )
          ) AS audiences
        FROM events e
        LEFT JOIN users u            ON u.id  = e.created_by
        LEFT JOIN event_audiences ea ON ea.event_id = e.id
        LEFT JOIN departments d      ON d.id = ea.department_id
        LEFT JOIN programs p         ON p.id = ea.program_id
        WHERE ${SQL_CSG_PRESIDENT_CREATOR}
        AND e.status IN ('Upcoming', 'Ongoing')
        ${periodClause}
        GROUP BY e.id
        ORDER BY e.date ASC`,
        periodParams,
      );
      res.status(200).json({ events: sanitizeEventRows(rows) });
      return;
    }

      // When logged in with a department token, only return:
      // - events marked as `is_all_departments`
      // - events that target the user's `department_id`
      // Governors: only events they created. Dept cashiers: college audience (any creator).
      if (departmentId) {
        const filterByCreator =
          isGovernorRole(role) && !!userId;
        const creatorSql = filterByCreator ? " AND e.created_by = ?" : "";

        const [rows]: any = await pool.execute(
          `SELECT
            e.*,
            u.username AS created_by_username,
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'department_id',   ea.department_id,
                'department_name', d.name,
                'department_code', d.code,
                'program_id',      ea.program_id,
                'course_code',     p.course_code,
                'course_name',     p.course_name,
                'major',           NULLIF(TRIM(p.major), ''),
                'year_level',      ea.year_level
              )
            ) AS audiences
          FROM events e
          LEFT JOIN users u            ON u.id  = e.created_by
          LEFT JOIN event_audiences ea ON ea.event_id = e.id AND (e.is_all_departments = 1 OR ea.department_id = ?)
          LEFT JOIN departments d      ON d.id = ea.department_id
          LEFT JOIN programs p         ON p.id = ea.program_id
          WHERE (e.is_all_departments = 1 OR ea.department_id = ?)
          AND e.status IN ('Upcoming', 'Ongoing')
          ${creatorSql}
          ${periodClause}
          GROUP BY e.id
          ORDER BY e.date ASC`,
          filterByCreator
            ? [departmentId, departmentId, userId, ...periodParams]
            : [departmentId, departmentId, ...periodParams]
        );

        res.status(200).json({ events: sanitizeEventRows(rows) });
        return;
      }

      // Public (not logged in): CSG / all-departments events unchanged, plus governor-created
      // upcoming & ongoing events for the public homepage.
      const govPlaceholders = ALL_GOVERNOR_ROLE_VALUES.map(() => "?").join(", ");
      const [rows]: any = await pool.execute(
        `SELECT * FROM (
          (
            SELECT
              e.*,
              u.username AS created_by_username,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'department_id',   ea.department_id,
                  'department_name', d.name,
                  'department_code', d.code,
                  'program_id',      ea.program_id,
                  'course_code',     p.course_code,
                  'course_name',     p.course_name,
                  'major',           NULLIF(TRIM(p.major), ''),
                  'year_level',      ea.year_level
                )
              ) AS audiences
            FROM events e
            LEFT JOIN users u            ON u.id  = e.created_by
            LEFT JOIN event_audiences ea ON ea.event_id = e.id AND e.is_all_departments = 1
            LEFT JOIN departments d      ON d.id = ea.department_id
            LEFT JOIN programs p         ON p.id = ea.program_id
            WHERE e.is_all_departments = 1
              AND e.status IN ('Upcoming', 'Ongoing')
              ${periodClause}
            GROUP BY e.id
          )
          UNION ALL
          (
            SELECT
              e.*,
              u.username AS created_by_username,
              JSON_ARRAYAGG(
                JSON_OBJECT(
                  'department_id',   ea.department_id,
                  'department_name', d.name,
                  'department_code', d.code,
                  'program_id',      ea.program_id,
                  'course_code',     p.course_code,
                  'course_name',     p.course_name,
                  'major',           NULLIF(TRIM(p.major), ''),
                  'year_level',      ea.year_level
                )
              ) AS audiences
            FROM events e
            INNER JOIN users creator ON creator.id = e.created_by
            LEFT JOIN users u            ON u.id = e.created_by
            LEFT JOIN event_audiences ea ON ea.event_id = e.id
            LEFT JOIN departments d      ON d.id = ea.department_id
            LEFT JOIN programs p         ON p.id = ea.program_id
            WHERE creator.role IN (${govPlaceholders})
              AND e.is_all_departments = 0
              AND e.status IN ('Upcoming', 'Ongoing')
              ${periodClause}
            GROUP BY e.id
          )
        ) AS public_events
        ORDER BY date ASC`,
        [...periodParams, ...ALL_GOVERNOR_ROLE_VALUES, ...periodParams]
      );
      console.log("get current events:", rows.length);

      res.status(200).json({ events: sanitizeEventRows(rows) });

  } catch (error) {
    console.error("[getCurrentEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}

  /** Super Admin only — reveal stored event attendance password (when recoverable). */
  async revealAttendancePassword(req: Request, res: Response): Promise<void> {
    if (String(req.user?.role ?? "").toLowerCase() !== "super_admin") {
      res.status(403).json({ message: "Access denied." });
      return;
    }
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      res.status(400).json({ message: "Invalid event id." });
      return;
    }
    try {
      const [rows]: any = await pool.execute(
        `SELECT attendance_password_hash, attendance_password_encrypted
         FROM events WHERE id = ? LIMIT 1`,
        [eventId],
      );
      if (!rows.length) {
        res.status(404).json({ message: "Event not found." });
        return;
      }
      const hasPassword = Boolean(rows[0].attendance_password_hash);
      const password = revealStoredPassword(rows[0].attendance_password_encrypted);
      res.status(200).json({
        hasPassword,
        password,
        recoverable: password != null,
      });
    } catch (error) {
      console.error("[revealAttendancePassword] Error:", error);
      res.status(500).json({ message: "Internal server error." });
    }
  }
}