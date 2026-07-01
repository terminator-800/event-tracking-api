import { Router } from "express";
import { StudentDashboardController } from "../controllers/student-dashboard.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

const router = Router();
const controller = new StudentDashboardController();

const STUDENT_ROLES = [
  "admin",
  "super_admin",
  "csg_president",
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
] as const;

router.get("/dashboard/students", authMiddleware, roleMiddleware(...STUDENT_ROLES), (req, res) => controller.list(req, res));
router.get("/dashboard/students/:studentId", authMiddleware, roleMiddleware(...STUDENT_ROLES), (req, res) => controller.detail(req, res));

export default router;
