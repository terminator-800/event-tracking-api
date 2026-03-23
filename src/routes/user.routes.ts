import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';

const router = Router();
const userController = new UserController();

router.post("/create-account", authMiddleware, roleMiddleware('admin'), (req, res) => userController.createUser(req, res));

export default router;
