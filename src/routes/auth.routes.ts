import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { loginLimiter } from '../middlewares/login.limiter';
import { permissionMiddleware } from "../middlewares/permission.middleware";

const router = Router();
const authController = new AuthController();

// public routes
router.post("/login", (req, res) => authController.login(req, res));
router.post("/logout", (req, res) => authController.logout(req, res));
router.post("/department-sign-in", loginLimiter, (req, res) => authController.departmentSignIn(req, res));

// protected routes
router.get("/me", authMiddleware, (req, res) => authController.me(req, res));
router.get("/department", authMiddleware, (req, res) => authController.departmentMe(req, res));
router.post(
  "/change-password",
  authMiddleware,
  permissionMiddleware("nav.settings.update_password"),
  (req, res) => authController.changePassword(req, res),
);

export default router;
