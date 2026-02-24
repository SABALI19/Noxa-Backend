import { Router } from "express";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  refreshAuthToken,
  registerUser,
} from "../controllers/users.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshAuthToken);
router.post("/logout", logoutUser);
router.get("/me", authMiddleware, getCurrentUser);

export default router;
