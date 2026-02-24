import { Router } from "express";
import {
  createGoal,
  deleteGoal,
  getGoalById,
  getGoals,
  updateGoal,
} from "../controllers/goals.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authMiddleware);

router.route("/").get(getGoals).post(createGoal);
router.route("/:id").get(getGoalById).patch(updateGoal).delete(deleteGoal);

export default router;
