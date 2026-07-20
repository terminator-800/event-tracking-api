import { Router } from "express";
import { AcademicPeriodController } from "../controllers/academic-period.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";

import { OPERATIONAL_ROLES } from "../utils/roles";

const router = Router();
const controller = new AcademicPeriodController();

router.get(
  "/academic-periods/active",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_ROLES),
  (req, res) => controller.getActive(req, res),
);

router.get(
  "/academic-periods",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("nav.settings.school_year", "action.academic_period.manage"),
  (req, res) => controller.list(req, res),
);

router.post(
  "/academic-periods",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.academic_period.manage"),
  (req, res) => controller.create(req, res),
);

router.patch(
  "/academic-periods/:id",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.academic_period.manage"),
  (req, res) => controller.update(req, res),
);

router.post(
  "/academic-periods/:id/activate",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.academic_period.manage"),
  (req, res) => controller.activate(req, res),
);

router.delete(
  "/academic-periods/:id",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.academic_period.manage"),
  (req, res) => controller.remove(req, res),
);

export default router;
