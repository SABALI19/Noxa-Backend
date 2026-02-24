import { Router } from "express";
import { createTrackingEvent, getTrackingByItem } from "../controllers/tracking.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authMiddleware);

router.post("/events", createTrackingEvent);
router.get("/:itemType/:itemId", getTrackingByItem);

export default router;
