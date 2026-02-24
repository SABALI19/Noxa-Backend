import { Router } from "express";
import {
  createTask,
  deleteTask,
  getTaskById,
  getTasks,
  updateTask,
} from "../controllers/tasks.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authMiddleware);

router.route("/").get(getTasks).post(createTask);
router.route("/:id").get(getTaskById).patch(updateTask).delete(deleteTask);

export default router;
