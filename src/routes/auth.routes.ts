import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { loginLimiter } from '../middlewares/login.limiter';

const router = Router();
const authController = new AuthController();

// public routes
router.post("/login", loginLimiter, (req, res) => authController.login(req, res));
router.post("/logout", (req, res) => authController.logout(req, res));
router.post("/department-sign-in", loginLimiter, (req, res) => authController.departmentSignIn(req, res));

// protected routes
router.get("/me", authMiddleware, (req, res) => authController.me(req, res));
router.get("/department", authMiddleware, (req, res) => authController.departmentMe(req, res));

export default router;
