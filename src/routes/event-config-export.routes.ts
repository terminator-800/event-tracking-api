import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { jsonConfigUploadMiddleware } from "../middlewares/json-config-upload.middleware";
import { EventConfigExportController } from "../controllers/event-config-export.controller";
import { AttendanceJsonExportController } from "../controllers/attendance-json-export.controller";

import { OPERATIONAL_ROLES } from "../utils/roles";

const router = Router();
const ctrl = new EventConfigExportController();
const attendanceCtrl = new AttendanceJsonExportController();

const EVENT_MANAGE_ROLES = roleMiddleware(...OPERATIONAL_ROLES);

const CSG_IMPORT_ROLES = roleMiddleware("admin", "super_admin", "csg_president");

/** Export complete event configuration (no attendance/payments). */
router.get(
  "/export/event/:eventId/config/roster",
  authMiddleware,
  EVENT_MANAGE_ROLES,
  (req, res) => ctrl.getRoster(req, res),
);

router.get(
  "/export/event/:eventId/config",
  authMiddleware,
  EVENT_MANAGE_ROLES,
  (req, res) => ctrl.exportConfig(req, res),
);

/** Preview import of an event config JSON file. */
router.post(
  "/export/event/config/preview",
  authMiddleware,
  EVENT_MANAGE_ROLES,
  jsonConfigUploadMiddleware.single("file"),
  (req, res) => ctrl.previewImport(req, res),
);

/** Import event configuration (creates Upcoming event + audiences). */
router.post(
  "/export/event/config/import",
  authMiddleware,
  EVENT_MANAGE_ROLES,
  jsonConfigUploadMiddleware.single("file"),
  (req, res) => ctrl.importConfig(req, res),
);

/** Department attendance JSON export (no event configuration). */
router.get(
  "/export/event/:eventId/attendance/json",
  authMiddleware,
  EVENT_MANAGE_ROLES,
  (req, res) => attendanceCtrl.exportAttendance(req, res),
);

/** CSG: preview attendance merge into master event by Event UUID. */
router.post(
  "/export/event/attendance/preview",
  authMiddleware,
  CSG_IMPORT_ROLES,
  jsonConfigUploadMiddleware.single("file"),
  (req, res) => attendanceCtrl.previewImport(req, res),
);

/** CSG: merge department attendance into master event. */
router.post(
  "/export/event/attendance/import",
  authMiddleware,
  CSG_IMPORT_ROLES,
  jsonConfigUploadMiddleware.single("file"),
  (req, res) => attendanceCtrl.importAttendance(req, res),
);

export default router;
