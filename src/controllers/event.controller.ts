import { Request, Response } from "express";
import { pool } from "../config/db";
import { ResultSetHeader } from "mysql2";
import { Role } from "../types/express";

interface CreateEventBody {
  name: string;
  date: string;
  venue: string;
  duration: "Whole Day" | "Half Day" | "AM Only" | "PM Only";
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

interface UpdateEventBody {
  name: string;
  date: string;
  venue: string;
  duration: "Whole Day" | "Half Day" | "AM Only" | "PM Only";
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

  const isAllDepartments = course_code === "All Departments";

  if (userRole !== "admin" && userRole !== "csg_president") {
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

  let resolvedProgramId: number | null = null;
  let resolvedDepartmentId: number | null = null;

  if (!isAllDepartments) {
    const parsedMajor = this.parseMajor(major);

    // always get department_id from course_code
    const [deptRows]: any = await pool.execute(
      `SELECT id, department_id FROM programs WHERE course_code = ? LIMIT 1`,
      [course_code]
    );

    if (!deptRows.length) {
      res.status(400).json({ message: "Program not found." });
      return;
    }

    resolvedDepartmentId = deptRows[0].department_id;

    if (parsedMajor !== null) {
      // specific major selected
      const [programRows]: any = await pool.execute(
        `SELECT id FROM programs WHERE course_code = ? AND major = ? LIMIT 1`,
        [course_code, parsedMajor]
      );
      if (!programRows.length) {
        res.status(400).json({ message: "Program not found." });
        return;
      }
      resolvedProgramId = programRows[0].id;
    } else {
      // all majors — check if single program (no majors dept)
      const [allPrograms]: any = await pool.execute(
        `SELECT id FROM programs WHERE course_code = ?`,
        [course_code]
      );
      resolvedProgramId = allPrograms.length === 1 ? allPrograms[0].id : null;
    }

    if (userRole !== "admin" && userRole !== "csg_president") {
      if (!resolvedDepartmentId || resolvedDepartmentId !== userDepartmentId) {
        res.status(403).json({ message: "Access denied for creating events outside your department." });
        return;
      }
    }
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [eventResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO events (
        name, date, venue, duration,
        am_time_in, am_grace_in, am_time_out, am_grace_out,
        pm_time_in, pm_grace_in, pm_time_out, pm_grace_out,
        is_mandatory, is_all_departments,
        status, audience_notes, fine_amount, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, date, venue, duration,
        amIn,  graceAmIn,  amOut, graceAmOut,
        pmIn,  gracePmIn,  pmOut, gracePmOut,
        isMandatory ? 1 : 0,
        isAllDepartments ? 1 : 0,
        status,
        audienceNotes || null,
        fineAmount ?? 0,
        createdBy,
      ]
    );

    const eventId = eventResult.insertId;

    if (!isAllDepartments) {
      if (!resolvedDepartmentId) {
        await connection.rollback();
        res.status(400).json({ message: "Invalid resolved department/program." });
        return;
      }

      await connection.execute(
        `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
          VALUES (?, ?, ?, ?)`,
        [eventId, resolvedDepartmentId, resolvedProgramId, this.parseYearLevel(yearLevel)]
      );
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

    const adminRoles: Role[] = ["admin", "csg_president"];
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
    if (statusKey === "completed" || statusKey === "ongoing" || statusKey === "active") {
      res.status(403).json({ message: "Completed or ongoing events cannot be deleted." });
      return;
    }

    const adminRoles: Role[] = ["admin", "csg_president"];
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

  // Only `admin` gets cross-department access. Governors must stay department-scoped.
  const adminRoles: Role[] = ["admin", "csg_president"];

try {
  let events: any[] = [];

  if (adminRoles.includes(userRole)) {
    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      GROUP BY e.id
      ORDER BY e.date DESC`
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

    const [rows]: any = await pool.execute(
      `SELECT
        e.*,
        u.username AS created_by_username,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'department_id',   ea.department_id,
            'department_name', d.name,
            'program_id',      ea.program_id,
            'course_code',     p.course_code,
            'course_name',     p.course_name,
            'year_level',      ea.year_level
          )
        ) AS audiences
      FROM events e
      LEFT JOIN users u            ON u.id  = e.created_by
      LEFT JOIN event_audiences ea ON ea.event_id = e.id
        AND (e.is_all_departments = 1 OR ea.department_id = ?)
      LEFT JOIN departments d      ON d.id = ea.department_id
      LEFT JOIN programs p         ON p.id = ea.program_id
      WHERE e.is_all_departments = 1
        OR ea.department_id = ?
      GROUP BY e.id
      ORDER BY e.date DESC`,
      [departmentId, departmentId]
    );
    events = rows;
  }

  // console.log("events:", events);
  console.log("Total events:", events.length);
  res.status(200).json({ events });

} catch (error) {
  console.error("[getEvents] Error:", error);
  res.status(500).json({ message: "Internal server error." });
}
}

async getCurrentEvent(req: Request, res: Response): Promise<void> {
  try {
    const departmentId = req.user?.department_id ?? null;
    const role = req.user?.role ?? null;

    console.log("[getCurrentEvent] user:", { role, departmentId });
      // When logged in with a department token, only return:
      // - events marked as `is_all_departments`
      // - events that target the user's `department_id`
      // And only include audiences matching the user's department (for non-all-dept events).
      if (departmentId) {
        const [rows]: any = await pool.execute(
          `SELECT
            e.*,
            u.username AS created_by_username,
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'department_id',   ea.department_id,
                'department_name', d.name,
                'program_id',      ea.program_id,
                'course_code',     p.course_code,
                'course_name',     p.course_name,
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
          GROUP BY e.id
          ORDER BY e.date ASC`,
          [departmentId, departmentId]
        );

        res.status(200).json({ events: rows });
        return;
      }

      // Public (not logged in): only show global events.
      const [rows]: any = await pool.execute(
        `SELECT
          e.*,
          u.username AS created_by_username,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'department_id',   ea.department_id,
              'department_name', d.name,
              'program_id',      ea.program_id,
              'course_code',     p.course_code,
              'course_name',     p.course_name,
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
        GROUP BY e.id
        ORDER BY e.date ASC`
      );
      console.log("get current events:", rows.length);
      
      res.status(200).json({ events: rows });

  } catch (error) {
    console.error("[getCurrentEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
}