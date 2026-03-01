import { Router } from "express";
import {
  getAiChatHistory,
  postAiMessage,
  upsertAiChatHistory,
} from "../controllers/ai.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/ai", authMiddleware, postAiMessage);
router.get("/v1/ai/chats", authMiddleware, getAiChatHistory);
router.put("/v1/ai/chats", authMiddleware, upsertAiChatHistory);

export default router;
