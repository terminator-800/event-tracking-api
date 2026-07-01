import { Router } from "express";
import { AttendancePageController } from "../controllers/attendance-page.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

const router = Router();
const controller = new AttendancePageController();

const attendancePageRoles = [
  "admin",
  "super_admin",
  "csg_president",
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
] as const;

router.get("/attendance/page/stream", authMiddleware, roleMiddleware(...attendancePageRoles), (req, res) =>
  controller.stream(req, res),
);

router.get("/attendance/page/events", authMiddleware, roleMiddleware(...attendancePageRoles), (req, res) =>
  controller.list(req, res),
);

router.get("/attendance/page/events/:eventId", authMiddleware, roleMiddleware(...attendancePageRoles), (req, res) =>
  controller.detail(req, res),
);

export default router;
