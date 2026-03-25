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
  isMandatory: boolean;
  status: "Upcoming" | "Ongoing" | "Completed" | "Cancelled";
  audienceNotes?: string;
  course_code: string;
  programId?: number;
  yearLevel?: string;
  major?: string;
  fineAmount?: number;
}

export class EventController {
  async createEvent(req: Request, res: Response): Promise<void> {
    console.log("createEvent hit", req.body);
    const createdBy: number = req.user?.id!;

    if (!createdBy) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const {
      name,
      date,
      venue,
      duration,
      amTimeIn,
      amTimeOut,
      pmTimeIn,
      pmTimeOut,
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

    const amIn  = to24Hour(amTimeIn);
    const amOut = to24Hour(amTimeOut);
    const pmIn  = to24Hour(pmTimeIn);
    const pmOut = to24Hour(pmTimeOut);

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      console.log("transaction started");

      const [eventResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO events (
          name, date, venue, duration,
          am_time_in, am_time_out,
          pm_time_in, pm_time_out,
          is_mandatory, is_all_departments,
          status, audience_notes, fine_amount, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, date, venue, duration,
          amIn, amOut, pmIn, pmOut,
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
        console.log("looking up department code:", course_code);

        const [deptRows]: any = await connection.execute(
          `SELECT id, department_id FROM programs WHERE course_code = ? LIMIT 1`,
          [course_code]
        );
        console.log("deptRows:", deptRows);

        if (!deptRows.length) {
          console.log("department not found");
          await connection.rollback();
          res.status(400).json({ message: "Department not found." });
          return;
        }

        const resolvedProgramId = deptRows[0].id;
        const resolvedDepartmentId = deptRows[0].department_id;

        console.log("inserting event_audiences...");
        await connection.execute(
          `INSERT INTO event_audiences (event_id, department_id, program_id, year_level)
           VALUES (?, ?, ?, ?)`,
          [eventId, resolvedDepartmentId, resolvedProgramId, parseYearLevel(yearLevel)]
        );
        console.log("event_audiences inserted");
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

  async getEvents(req: Request, res: Response): Promise<void> {
    const userId   = req.user?.id!;
    const userRole = req.user?.role!;
  
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
  
    const adminRoles: Role[] = ["admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"];
  
    try {
      let events: any[] = [];
  
      if (adminRoles.includes(userRole)) {
        const [rows]: any = await pool.execute(
          `SELECT
            e.*,
            u.username AS created_by_username,
            JSON_ARRAYAGG(
              JSON_OBJECT(
                'department_id', ea.department_id,
                'program_id',    ea.program_id,
                'year_level',    ea.year_level
              )
            ) AS audiences
          FROM events e
          LEFT JOIN users u  ON u.id  = e.created_by
          LEFT JOIN event_audiences ea ON ea.event_id = e.id
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
                'department_id', ea.department_id,
                'program_id',    ea.program_id,
                'year_level',    ea.year_level
              )
            ) AS audiences
          FROM events e
          LEFT JOIN users u  ON u.id  = e.created_by
          LEFT JOIN event_audiences ea ON ea.event_id = e.id
          WHERE e.is_all_departments = 1
            OR ea.department_id = ?
          GROUP BY e.id
          ORDER BY e.date DESC`,
          [departmentId]
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
}