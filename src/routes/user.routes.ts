import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from'../middlewares/auth.middleware';
import { roleMiddleware } from'../middlewares/role.middleware';
import { optionalAuthMiddleware } from "../middlewares/optional-auth.middleware";
import { EventController } from '../controllers/event.controller';

const router = Router();
const userController = new UserController();
const eventController = new EventController();

router.post("/create-account", authMiddleware, roleMiddleware('admin'), (req, res) => userController.createUser(req, res));
router.post("/create/events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.createEvent(req, res));
router.get("/get-events", authMiddleware, roleMiddleware("admin","csg_president","it_governor","cba_governor","ceas_governor", "coc_governor", "chm_governor"), (req, res) => eventController.getEvents(req, res));
router.get("/get-current-event", optionalAuthMiddleware, (req, res) => eventController.getCurrentEvent(req, res));

export default router;
