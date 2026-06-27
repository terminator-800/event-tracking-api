import { Router } from "express";
import { StudentDashboardController } from "../controllers/student-dashboard.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { OPERATIONAL_DESK_ROLES } from "../utils/roles";

const router = Router();
const controller = new StudentDashboardController();

router.get(
  "/dashboard/students",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.list(req, res),
);

router.get(
  "/dashboard/students/:studentId",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.detail(req, res),
);

export default router;
