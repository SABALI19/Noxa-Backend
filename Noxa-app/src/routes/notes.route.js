import { Router } from "express";
import {
  createNote,
  deleteNote,
  getNoteById,
  getNotes,
  updateNote,
} from "../controllers/notes.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authMiddleware);

router.route("/").get(getNotes).post(createNote);
router.route("/:id").get(getNoteById).patch(updateNote).delete(deleteNote);

export default router;
