import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { requireActiveAcademicPeriod } from "../middlewares/active-academic-period.middleware";
import { PaymentController } from "../controllers/payment.controller";
import { OPERATIONAL_DESK_ROLES } from "../utils/roles";

const router = Router();
const controller = new PaymentController();

router.get(
  "/payments/summary",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.summary(req, res),
);

router.get(
  "/payments/transactions",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.transactions(req, res),
);

router.get(
  "/payments/students/lookup",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.lookup(req, res),
);

router.get(
  "/payments/students",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.list(req, res),
);

router.get(
  "/payments/students/:studentId",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  (req, res) => controller.getOne(req, res),
);

router.post(
  "/payments/record",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  requireActiveAcademicPeriod,
  (req, res) => controller.record(req, res),
);

router.put(
  "/payments/fines/:fineId",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  requireActiveAcademicPeriod,
  (req, res) => controller.updateFineAmount(req, res),
);

router.put(
  "/payments/students/:studentId/balance",
  authMiddleware,
  roleMiddleware(...OPERATIONAL_DESK_ROLES),
  requireActiveAcademicPeriod,
  (req, res) => controller.setStudentBalance(req, res),
);

export default router;
