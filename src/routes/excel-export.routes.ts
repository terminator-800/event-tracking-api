import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { xlsxUploadMiddleware } from "../middlewares/xlsx-upload.middleware";
import { ExcelExportController } from "../controllers/excel-export.controller";

const router = Router();
const ctrl = new ExcelExportController();

const CSG_ONLY = roleMiddleware("csg_president");

const ALL_EXPORT_ROLES = roleMiddleware(
  "admin",
  "super_admin",
  "csg_president",
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
);

// Export — all operational roles
router.get("/export/event/:eventId/excel", authMiddleware, ALL_EXPORT_ROLES, (req, res) => ctrl.exportEvent(req, res));
router.get("/export/events/excel", authMiddleware, ALL_EXPORT_ROLES, (req, res) => ctrl.exportAllEvents(req, res));

// Import — CSG President only
router.post(
  "/export/event/import-preview",
  authMiddleware,
  CSG_ONLY,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importPreview(req, res),
);
router.post(
  "/export/event/import",
  authMiddleware,
  CSG_ONLY,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importExcel(req, res),
);
// Full import: creates event + students + attendance + fines + payments
router.post(
  "/export/event/import-full",
  authMiddleware,
  CSG_ONLY,
  xlsxUploadMiddleware.single("file"),
  (req, res) => ctrl.importEventFull(req, res),
);

// Audit log — CSG President only
router.get("/export/audit-log", authMiddleware, CSG_ONLY, (req, res) => ctrl.getAuditLog(req, res));

export default router;
