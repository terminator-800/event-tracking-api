import { Router } from "express";
import { StudentDashboardController } from "../controllers/student-dashboard.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

const router = Router();
const controller = new StudentDashboardController();

router.get(
  "/dashboard/students",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.list(req, res),
);

router.get(
  "/dashboard/students/:studentId",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.detail(req, res),
);

export default router;
