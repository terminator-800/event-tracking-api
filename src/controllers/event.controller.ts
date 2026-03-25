import { Request, Response } from "express";
import { pool } from "../config/db";
import { ResultSetHeader } from "mysql2";

function to24Hour(time: string | null | undefined): string | null {
  if (!time) return null;

  const [timePart, meridiem] = time.trim().split(" ");
  let [h, m] = timePart.split(":").map(Number);

  if (meridiem?.toUpperCase() === "PM" && h !== 12) h += 12;
  if (meridiem?.toUpperCase() === "AM" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function parseYearLevel(yearLevel: string | null | undefined): number | null {
  if (!yearLevel || yearLevel === "All Year Levels") return null;
  const match = yearLevel.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

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
          status, audience_notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, date, venue, duration,
          amIn, amOut, pmIn, pmOut,
          isMandatory ? 1 : 0,
          isAllDepartments ? 1 : 0,
          status,
          audienceNotes || null,
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
}