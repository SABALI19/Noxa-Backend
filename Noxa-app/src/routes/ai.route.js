import { Router } from "express";
import {
  getAiActionLogs,
  getAiChatHistory,
  postAiMessage,
  streamAiMessage,
  upsertAiChatHistory,
} from "../controllers/ai.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/ai", authMiddleware, postAiMessage);
router.post("/ai/stream", authMiddleware, streamAiMessage);
router.get("/v1/ai/chats", authMiddleware, getAiChatHistory);
router.put("/v1/ai/chats", authMiddleware, upsertAiChatHistory);
router.get("/v1/ai/actions", authMiddleware, getAiActionLogs);

export default router;
