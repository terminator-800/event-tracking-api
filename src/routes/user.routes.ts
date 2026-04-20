import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware";
import { EventController } from '../controllers/event.controller';
import { AttendanceController } from "../controllers/attendance.controller";

const router = Router();
const userController = new UserController();
const eventController = new EventController();
const attendanceController = new AttendanceController();

router.post("/create-account", authMiddleware, roleMiddleware('admin'), (req, res) => userController.createUser(req, res));
router.post("/create/events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.createEvent(req, res));
router.put("/update/events/:id", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.updateEvent(req, res));
router.get("/get-events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.getEvents(req, res));
router.get("/get-current-event", optionalAuthMiddleware, (req, res) => eventController.getCurrentEvent(req, res));
router.post("/attendance/time-in-out", attendanceController.recordAttendance);

export default router;
