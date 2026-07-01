import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { ExportSecurityController } from "../controllers/export-security.controller";

const router = Router();
const controller = new ExportSecurityController();

const CSG_ONLY = roleMiddleware("csg_president");

const ALL_OPERATIONAL_ROLES = roleMiddleware(
  "admin",
  "super_admin",
  "csg_president",
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
);

// CSG President management
router.get("/export-security/settings", authMiddleware, CSG_ONLY, (req, res) => controller.getSettings(req, res));
router.post("/export-security/password", authMiddleware, CSG_ONLY, (req, res) => controller.setPassword(req, res));
router.patch("/export-security/toggle", authMiddleware, CSG_ONLY, (req, res) => controller.toggle(req, res));
router.post("/export-security/verify", authMiddleware, CSG_ONLY, (req, res) => controller.verifyFile(req, res));

// All operational users — retrieve decrypted password for PDF export
router.get("/export-security/export-key", authMiddleware, ALL_OPERATIONAL_ROLES, (req, res) => controller.getExportKey(req, res));

// All operational users — retrieve settings (is_enabled + fingerprint) for signing CSV exports
router.get("/export-security/public-settings", authMiddleware, ALL_OPERATIONAL_ROLES, (req, res) => controller.getSettings(req, res));

export default router;
