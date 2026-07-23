import { Router } from "express";
import { RbacController } from "../controllers/rbac.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { roleMiddleware } from "../middlewares/role.middleware";
import { permissionMiddleware } from "../middlewares/permission.middleware";

const router = Router();
const controller = new RbacController();

router.get("/rbac/my-permissions", authMiddleware, (req, res) => controller.myPermissions(req, res));

router.get(
  "/rbac/matrix",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.rbac.manage"),
  (req, res) => controller.getMatrix(req, res),
);

router.put(
  "/rbac/matrix",
  authMiddleware,
  roleMiddleware("super_admin"),
  permissionMiddleware("action.rbac.manage"),
  (req, res) => controller.saveMatrix(req, res),
);

export default router;
