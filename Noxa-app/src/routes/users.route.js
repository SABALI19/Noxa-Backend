import { Router } from "express";
import {
  getPushPublicKey,
  getCurrentUser,
  loginUser,
  logoutUser,
  refreshAuthToken,
  registerUser,
  subscribePushNotifications,
  unsubscribePushNotifications,
} from "../controllers/users.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/signup", registerUser);
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshAuthToken);
router.post("/logout", logoutUser);
router.get("/push/public-key", getPushPublicKey);
router.post("/push/subscribe", authMiddleware, subscribePushNotifications);
router.post("/push/unsubscribe", authMiddleware, unsubscribePushNotifications);
router.get("/me", authMiddleware, getCurrentUser);

export default router;
