import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";
import { requireActiveAcademicPeriod } from "../middlewares/active-academic-period.middleware";
import { PaymentController } from "../controllers/payment.controller";

import { OPERATIONAL_ROLES } from "../utils/roles";

const router = Router();
const controller = new PaymentController();

const canViewPayments = permissionMiddleware("nav.cashier.payments", "nav.cashier.station", "action.payment.record");
const canRecordPayment = permissionMiddleware("action.payment.record");

router.get("/payments/summary", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canViewPayments, (req, res) => controller.summary(req, res));
router.get("/payments/transactions", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canViewPayments, (req, res) => controller.transactions(req, res));
router.get("/payments/students/lookup", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canViewPayments, (req, res) => controller.lookup(req, res));
router.get("/payments/students", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canViewPayments, (req, res) => controller.list(req, res));
router.get("/payments/students/:studentId", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canViewPayments, (req, res) => controller.getOne(req, res));
router.post("/payments/record", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canRecordPayment, requireActiveAcademicPeriod, (req, res) => controller.record(req, res));
router.put("/payments/fines/:fineId", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canRecordPayment, requireActiveAcademicPeriod, (req, res) => controller.updateFineAmount(req, res));
router.put("/payments/students/:studentId/balance", authMiddleware, roleMiddleware(...OPERATIONAL_ROLES), canRecordPayment, requireActiveAcademicPeriod, (req, res) => controller.setStudentBalance(req, res));
router.delete(
  "/payments/transactions/:id",
  authMiddleware,
  roleMiddleware("super_admin"),
  (req, res) => controller.deleteTransaction(req, res),
);

export default router;
