import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";
import { xlsxUploadMiddleware } from "../middlewares/xlsx-upload.middleware";
import { ExcelExportController } from "../controllers/excel-export.controller";

import { OPERATIONAL_ROLES } from "../utils/roles";

const router = Router();
const ctrl = new ExcelExportController();

const CSG_ONLY = roleMiddleware("csg_president");

const ALL_EXPORT_ROLES = roleMiddleware(...OPERATIONAL_ROLES);

const canExport = permissionMiddleware(
  "action.event.export_config",
  "action.event.export_attendance",
  "action.event.export",
);

// Export — all operational roles
router.get("/export/event/:eventId/excel", authMiddleware, ALL_EXPORT_ROLES, canExport, (req, res) => ctrl.exportEvent(req, res));
router.get("/export/events/excel", authMiddleware, ALL_EXPORT_ROLES, canExport, (req, res) => ctrl.exportAllEvents(req, res));

// Import — CSG President only
router.post(
  "/export/event/import-preview",
  authMiddleware,
  CSG_ONLY,
  canExport,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importPreview(req, res),
);
router.post(
  "/export/event/import",
  authMiddleware,
  CSG_ONLY,
  canExport,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importExcel(req, res),
);
// Full import: creates event + students + attendance + fines + payments
router.post(
  "/export/event/import-full",
  authMiddleware,
  CSG_ONLY,
  canExport,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importEventFull(req, res),
);

// Audit log — CSG President only
router.get("/export/audit-log", authMiddleware, CSG_ONLY, (req, res) => ctrl.getAuditLog(req, res));

export default router;
