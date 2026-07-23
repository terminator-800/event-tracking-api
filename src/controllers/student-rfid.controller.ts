import type { Request, Response } from "express";
import {
  findStudentRfidProfileByPublicId,
  searchStudentRfidProfiles,
  updateStudentRfidByPublicId,
} from "../repositories/student-rfid.repository";

export class StudentRfidController {
  lookup = async (req: Request, res: Response): Promise<void> => {
    try {
      const identifier = String(req.query.identifier ?? req.query.q ?? "").trim();
      if (!identifier) {
        res.status(400).json({ message: "Name or Student ID is required." });
        return;
      }

      const students = await searchStudentRfidProfiles(identifier);
      if (students.length === 0) {
        res.status(404).json({ message: "Student not found." });
        return;
      }

      res.status(200).json({
        students,
        student: students.length === 1 ? students[0] : null,
      });
    } catch (error) {
      console.error("[StudentRfidController.lookup]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const studentId = String(req.params.studentId ?? "").trim();
      if (!studentId) {
        res.status(400).json({ message: "Student ID is required." });
        return;
      }

      const rawRfid = req.body?.rfid;
      if (rawRfid === undefined) {
        res.status(400).json({ message: "RFID is required." });
        return;
      }

      const rfid =
        rawRfid == null || String(rawRfid).trim() === ""
          ? null
          : String(rawRfid).trim();

      if (rfid != null && rfid.length > 32) {
        res.status(400).json({ message: "RFID must be 32 characters or fewer." });
        return;
      }

      const status = await updateStudentRfidByPublicId(studentId, rfid);
      if (status === "not_found") {
        res.status(404).json({ message: "Student not found." });
        return;
      }
      if (status === "duplicate") {
        res.status(409).json({ message: "This RFID is already assigned to another student." });
        return;
      }

      const student = await findStudentRfidProfileByPublicId(studentId);
      res.status(200).json({
        message: rfid ? "Student RFID updated." : "Student RFID cleared.",
        student,
      });
    } catch (error) {
      console.error("[StudentRfidController.update]", error);
      res.status(500).json({ message: "Internal server error." });
    }
  };
}
