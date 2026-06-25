import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware";
import { EventController } from '../controllers/event.controller';
import { AttendanceController } from "../controllers/attendance.controller";
import { csvUploadMiddleware } from "../middlewares/upload.middleware";
import { DataResetController } from "../controllers/data-reset.controller";

const router = Router();
const userController = new UserController();
const eventController = new EventController();
const attendanceController = new AttendanceController();
const dataResetController = new DataResetController();

router.post("/create-account", authMiddleware, roleMiddleware('admin'), (req, res) => userController.createUser(req, res));
router.get("/departments", authMiddleware, roleMiddleware("admin"), (req, res) => userController.listDepartments(req, res));
router.get("/users", authMiddleware, roleMiddleware("admin"), (req, res) => userController.listUsers(req, res));
router.put("/users/:id", authMiddleware, roleMiddleware("admin"), (req, res) => userController.updateUser(req, res));
router.delete("/users/:id", authMiddleware, roleMiddleware("admin"), (req, res) => userController.deleteUser(req, res));
router.post("/import/students-csv", authMiddleware, roleMiddleware("admin"), csvUploadMiddleware.single("file"),(req, res) => userController.importStudentsCsv(req, res),);
router.get("/admin/data-reset/preview", authMiddleware, roleMiddleware("admin"), (req, res) =>
  dataResetController.preview(req, res),
);
router.post("/admin/data-reset", authMiddleware, roleMiddleware("admin"), (req, res) =>
  dataResetController.reset(req, res),
);
router.post("/create/events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.createEvent(req, res));
router.put("/update/events/:id", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.updateEvent(req, res));
router.delete("/delete/events/:id", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.deleteEvent(req, res));
router.get("/get-events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.getEvents(req, res));
router.get("/get-current-event", optionalAuthMiddleware, (req, res) => eventController.getCurrentEvent(req, res));
router.post("/attendance/verify-event-password", (req, res) =>
  attendanceController.verifyEventPassword(req, res),
);
router.post("/attendance/time-in-out", attendanceController.recordAttendance);

export default router;
