import { Router } from "express";
import { postAiMessage } from "../controllers/ai.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/ai", authMiddleware, postAiMessage);

export default router;
