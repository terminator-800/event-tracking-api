import { Request, Response } from "express";
import { pool } from "../config/db";
import { ResultSetHeader } from "mysql2";
import { to24Hour, parseYearLevel } from "../controllers/services/event.service";
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

export class EventController {
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
      amTimeIn,
      amTimeOut,
      pmTimeIn,
      pmTimeOut,
      am_grace_in,   
      am_grace_out,  
      pm_grace_in,   
      pm_grace_out,
      isMandatory,
      status,
      audienceNotes,
      course_code,
      programId,
      yearLevel,
      fineAmount,
    }: CreateEventBody = req.body;

    if (!name || !date || !venue || !duration || !status) {
      res.status(400).json({ message: "Missing required fields." });
      return;
    }

    const isAllDepartments = course_code === "All Departments";

    // Non-admin users (e.g. governors) may only create events for their own department.
    // Defense-in-depth: the route already restricts roles, but we enforce department match here too.
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

    const amIn  = to24Hour(amTimeIn);
    const amOut = to24Hour(amTimeOut);
    const pmIn  = to24Hour(pmTimeIn);
    const pmOut = to24Hour(pmTimeOut);

    // sanitize grace periods
    const graceAmIn  = Math.max(0, Math.floor(am_grace_in  ?? 0));
    const graceAmOut = Math.max(0, Math.floor(am_grace_out ?? 0));
    const gracePmIn  = Math.max(0, Math.floor(pm_grace_in  ?? 0));
    const gracePmOut = Math.max(0, Math.floor(pm_grace_out ?? 0));

    // Resolve department/program from course_code up-front so we can authorize before inserting anything.
    let resolvedProgramId: number | null = null;
    let resolvedDepartmentId: number | null = null;

    if (!isAllDepartments) {
      const [deptRows]: any = await pool.execute(
        `SELECT id, department_id FROM programs WHERE course_code = ? LIMIT 1`,
        [course_code]
      );

      if (!deptRows.length) {
        res.status(400).json({ message: "Department not found." });
        return;
      }

      resolvedProgramId = deptRows[0].id;
      resolvedDepartmentId = deptRows[0].department_id;

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
      console.log("transaction started");

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
      console.log("event inserted, id:", eventResult.insertId);

      const eventId = eventResult.insertId;

      if (!isAllDepartments) {
        if (!resolvedProgramId || !resolvedDepartmentId) {
          await connection.rollback();
          res.status(400).json({ message: "Invalid resolved department/program." });
          return;
        }

        console.log("inserting event_audiences...");
        await connection.execute(
          `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
           VALUES (?, ?, ?, ?)`,
          [eventId, resolvedDepartmentId, resolvedProgramId, parseYearLevel(yearLevel)]
        );
        console.log("event_audiences inserted");
      }

      await connection.commit();
      console.log("committed")

      res.status(201).json({ message: "Event created successfully.", eventId });
    } catch (error) {
      await connection.rollback();
      console.error("[createEvent] Error:", error);
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
    const adminRoles: Role[] = ["admin"];

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

    console.log("events:", events);
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
      console.log("get current events:", rows);
      
      res.status(200).json({ events: rows });

  } catch (error) {
    console.error("[getCurrentEvent] Error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
}
}