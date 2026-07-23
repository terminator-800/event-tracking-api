import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";
import { OPERATIONAL_ROLES } from "../utils/roles";
import { StudentRfidController } from "../controllers/student-rfid.controller";

const router = Router();
const controller = new StudentRfidController();

const canUpdateRfid = permissionMiddleware(
  "nav.settings.update_rfid",
  "action.students.update_rfid",
);

router.get(
  "/students/rfid/lookup",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_ROLES),
  canUpdateRfid,
  (req, res) => controller.lookup(req, res),
);

router.patch(
  "/students/:studentId/rfid",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_ROLES),
  canUpdateRfid,
  (req, res) => controller.update(req, res),
);

export default router;
