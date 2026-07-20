import { Router } from "express";
import { AttendancePageController } from "../controllers/attendance-page.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

import { OPERATIONAL_ROLES } from "../utils/roles";

const router = Router();
const controller = new AttendancePageController();

router.get("/attendance/page/stream", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), (req, res) =>
  controller.stream(req, res),
);

router.get("/attendance/page/events", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), (req, res) =>
  controller.list(req, res),
);

router.get("/attendance/page/events/:eventId", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), (req, res) =>
  controller.detail(req, res),
);

export default router;
