import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";
import { OPERATIONAL_ROLES } from "../utils/roles";
import { SemesterBackupController } from "../controllers/semester-backup.controller";

const router = Router();
const controller = new SemesterBackupController();

router.get(
  "/backup/semester/:periodId",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_ROLES),
  permissionMiddleware("nav.settings.backup", "action.backup.download"),
  (req, res) => controller.download(req, res),
);

export default router;
