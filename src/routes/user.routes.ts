import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';
import { requireActiveAcademicPeriod } from "../middlewares/active-academic-period.middleware";
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

// ── User management (admin + super_admin) ─────────────────────────────────────
router.post("/create-account", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) => userController.createUser(req, res));
router.get("/departments", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) => userController.listDepartments(req, res));
router.get("/users", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) => userController.listUsers(req, res));
router.put("/users/:id", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) => userController.updateUser(req, res));
router.delete("/users/:id", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) => userController.deleteUser(req, res));

// ── Admin + Super Admin routes ────────────────────────────────────────────────
router.post("/import/students-csv", authMiddleware, roleMiddleware("admin", "super_admin"), requireActiveAcademicPeriod, csvUploadMiddleware.single("file"),(req, res) => userController.importStudentsCsv(req, res),);
router.get("/admin/data-reset/preview", authMiddleware, roleMiddleware("admin", "super_admin"), (req, res) =>
  dataResetController.preview(req, res),
);
router.post("/admin/data-reset", authMiddleware, roleMiddleware("admin", "super_admin"), requireActiveAcademicPeriod, (req, res) =>
  dataResetController.reset(req, res),
);

// ── Super Admin exclusive routes ──────────────────────────────────────────────
router.get("/super-admin/stats", authMiddleware, roleMiddleware("super_admin"), (req, res) => userController.getSuperAdminStats(req, res));
router.get("/super-admin/audit-logs", authMiddleware, roleMiddleware("super_admin"), (req, res) => userController.getAuditLogs(req, res));

// ── Events (all operational roles + super_admin) ──────────────────────────────
router.post("/create/events", authMiddleware, roleMiddleware("admin","super_admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), requireActiveAcademicPeriod, (req, res) => eventController.createEvent(req, res));
router.put("/update/events/:id", authMiddleware, roleMiddleware("admin","super_admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), requireActiveAcademicPeriod, (req, res) => eventController.updateEvent(req, res));
router.delete("/delete/events/:id", authMiddleware, roleMiddleware("admin","super_admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), requireActiveAcademicPeriod, (req, res) => eventController.deleteEvent(req, res));
router.get("/get-events", authMiddleware, roleMiddleware("admin","super_admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.getEvents(req, res));
router.get("/get-current-event", optionalAuthMiddleware, (req, res) => eventController.getCurrentEvent(req, res));
router.post("/attendance/verify-event-password", (req, res) =>
  attendanceController.verifyEventPassword(req, res),
);
router.post("/attendance/time-in-out", attendanceController.recordAttendance);

export default router;
