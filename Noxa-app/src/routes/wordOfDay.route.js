import { Router } from "express";
import {
  createCommunityWord,
  getFeaturedCommunityWord,
  listPendingCommunityWords,
  listCommunityWords,
  moderateCommunityWord,
} from "../controllers/wordOfDay.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { User } from "../models/user.model.js";
import { createError } from "../utils/http.js";

const router = Router();

const ensureWordModerator = async (req, _res, next) => {
  try {
    const user = await User.findById(req.user.id).select("role");
    const role = String(user?.role || "member").trim().toLowerCase();

    if (role !== "admin" && role !== "super_admin") {
      next(createError(403, "Moderator access is required"));
      return;
    }

    next();
  } catch (_error) {
    next(createError(403, "Moderator access is required"));
  }
};

router.get("/", listCommunityWords);
router.get("/featured", getFeaturedCommunityWord);
router.post("/", authMiddleware, createCommunityWord);
router.get("/moderation/pending", authMiddleware, ensureWordModerator, listPendingCommunityWords);
router.patch("/:id/moderate", authMiddleware, ensureWordModerator, moderateCommunityWord);

export default router;
