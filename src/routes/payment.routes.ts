import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { PaymentController } from "../controllers/payment.controller";

const router = Router();
const controller = new PaymentController();

router.get(
  "/payments/students",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.list(req, res),
);

router.post(
  "/payments/record",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.record(req, res),
);

router.put(
  "/payments/fines/:fineId",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.updateFineAmount(req, res),
);

router.put(
  "/payments/students/:studentId/balance",
  authMiddleware,
  roleMiddleware(
    "admin",
    "csg_president",
    "it_governor",
    "cba_governor",
    "ceas_governor",
    "coc_governor",
    "chm_governor",
  ),
  (req, res) => controller.setStudentBalance(req, res),
);

export default router;
