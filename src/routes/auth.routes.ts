import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authMiddleware } from'../middlewares/auth.middleware';

const router = Router();
const authController = new AuthController();

// public routes
router.post("/login", (req, res) => authController.login(req, res));
router.post("/logout", (req, res) => authController.logout(req, res));

// protected routes
router.get("/me", authMiddleware, (req, res) => authController.me(req, res));

export default router;
