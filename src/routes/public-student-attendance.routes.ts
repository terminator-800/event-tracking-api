import { Router } from "express";
import { PublicStudentAttendanceController } from "../controllers/public-student-attendance.controller";

const router = Router();
const controller = new PublicStudentAttendanceController();

/** Public landing-page lookup — no auth. Identifier = student ID or RFID. */
router.get("/public/student-attendance", (req, res) => controller.lookup(req, res));

export default router;
