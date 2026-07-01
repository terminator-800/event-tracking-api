import { Router } from "express";
import { AcademicPeriodController } from "../controllers/academic-period.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";

const router = Router();
const controller = new AcademicPeriodController();

const operationalRoles = [
  "admin",
  "csg_president",
  "it_governor",
  "cba_governor",
  "ceas_governor",
  "coc_governor",
  "chm_governor",
] as const;

router.get(
  "/academic-periods/active",
  authMiddleware,
  roleMiddleware("super_admin", ...operationalRoles),
  (req, res) => controller.getActive(req, res),
);

router.get(
  "/academic-periods",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.list(req, res),
);

router.post(
  "/academic-periods",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.create(req, res),
);

router.patch(
  "/academic-periods/:id",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.update(req, res),
);

router.post(
  "/academic-periods/:id/activate",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.activate(req, res),
);

router.delete(
  "/academic-periods/:id",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.remove(req, res),
);

export default router;
