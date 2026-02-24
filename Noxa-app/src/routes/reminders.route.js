import { Router } from "express";
import {
  createReminder,
  deleteReminder,
  getReminders,
  snoozeReminder,
  updateReminder,
} from "../controllers/reminders.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authMiddleware);

router.route("/").get(getReminders).post(createReminder);
router.route("/:id").patch(updateReminder).delete(deleteReminder);
router.post("/:id/snooze", snoozeReminder);

export default router;
