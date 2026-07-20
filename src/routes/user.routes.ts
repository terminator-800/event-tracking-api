import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';
import { permissionMiddleware } from "../middlewares/permission.middleware";
import { requireActiveAcademicPeriod } from "../middlewares/active-academic-period.middleware";
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware";
import { EventController } from '../controllers/event.controller';
import { AttendanceController } from "../controllers/attendance.controller";
import { csvUploadMiddleware } from "../middlewares/upload.middleware";
import { DataResetController } from "../controllers/data-reset.controller";
import { OPERATIONAL_ROLES, STAFF_ROLES } from "../utils/roles";

const router = Router();
const userController = new UserController();
const eventController = new EventController();
const attendanceController = new AttendanceController();
const dataResetController = new DataResetController();

// ── User management (permission-gated) ────────────────────────────────────────
router.post("/create-account", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.users.manage"), (req, res) => userController.createUser(req, res));
router.get("/departments", authMiddleware, roleMiddleware(...STAFF_ROLES), (req, res) => userController.listDepartments(req, res));
router.get("/users", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("nav.users", "nav.users.list", "action.users.manage", "action.rbac.manage"), (req, res) => userController.listUsers(req, res));
router.put("/users/:id", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.users.manage", "action.rbac.manage"), (req, res) => userController.updateUser(req, res));
router.delete("/users/:id", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.users.manage"), (req, res) => userController.deleteUser(req, res));

// ── Import / data reset (permission-gated) ────────────────────────────────────
router.post("/import/students-csv", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.import.csv"), requireActiveAcademicPeriod, csvUploadMiddleware.single("file"),(req, res) => userController.importStudentsCsv(req, res),);
router.get("/admin/data-reset/preview", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.import.reset", "action.import.csv"), (req, res) =>
  dataResetController.preview(req, res),
);
router.post("/admin/data-reset", authMiddleware, roleMiddleware(...STAFF_ROLES), permissionMiddleware("action.import.reset", "action.import.csv"), requireActiveAcademicPeriod, (req, res) =>
  dataResetController.reset(req, res),
);

// ── Super Admin exclusive routes ──────────────────────────────────────────────
router.get("/super-admin/stats", authMiddleware, roleMiddleware("super_admin"), (req, res) => userController.getSuperAdminStats(req, res));
router.get("/super-admin/audit-logs", authMiddleware, roleMiddleware("super_admin"), permissionMiddleware("nav.settings.audit_logs"), (req, res) => userController.getAuditLogs(req, res));

// ── Events (all operational roles + super_admin) ──────────────────────────────
router.post("/create/events", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), permissionMiddleware("action.event.create"), requireActiveAcademicPeriod, (req, res) => eventController.createEvent(req, res));
router.put("/update/events/:id", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), permissionMiddleware("action.event.edit"), requireActiveAcademicPeriod, (req, res) => eventController.updateEvent(req, res));
router.delete(
  "/delete/events/:id",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_ROLES),
  permissionMiddleware("action.event.delete"),
  (req, res, next) => {
    // Super admin can delete events even when no academic period is active.
    if (String(req.user?.role ?? "").toLowerCase() === "super_admin") {
      next();
      return;
    }
    void requireActiveAcademicPeriod(req, res, next);
  },
  (req, res) => eventController.deleteEvent(req, res),
);
router.get("/get-events", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), permissionMiddleware("nav.manage_event.list", "nav.manage_event.create", "action.event.create"), (req, res) => eventController.getEvents(req, res));
router.get("/get-current-event", optionalAuthMiddleware, (req, res) => eventController.getCurrentEvent(req, res));
router.post("/attendance/verify-event-password", (req, res) =>
  attendanceController.verifyEventPassword(req, res),
);
router.post("/attendance/time-in-out", attendanceController.recordAttendance);

export default router;