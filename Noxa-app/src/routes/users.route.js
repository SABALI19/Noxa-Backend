import { Router } from "express";
import {
  forgotPassword,
  getPushPublicKey,
  getCurrentUser,
  loginUser,
  logoutUser,
  refreshAuthToken,
  registerUser,
  resendSignupVerification,
  resetPassword,
  subscribePushNotifications,
  updateCurrentUserProfile,
  unsubscribePushNotifications,
  verifyLoginOtp,
  verifySignupEmail,
} from "../controllers/users.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { apiLimiter } from "../middlewares/rateLimiter.js";

const router = Router();

router.post("/signup", registerUser);
router.post("/register", registerUser);
router.post("/signup/verify-email", apiLimiter, verifySignupEmail);
router.post("/register/verify-email", apiLimiter, verifySignupEmail);
router.post("/signup/resend-verification", apiLimiter, resendSignupVerification);
router.post("/register/resend-verification", apiLimiter, resendSignupVerification);
router.post("/login", apiLimiter, loginUser);
router.post("/login/verify-otp", apiLimiter, verifyLoginOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/refresh", refreshAuthToken);
router.post("/logout", logoutUser);
router.get("/push/public-key", getPushPublicKey);
router.post("/push/subscribe", authMiddleware, subscribePushNotifications);
router.post("/push/unsubscribe", authMiddleware, unsubscribePushNotifications);
router.get("/me", authMiddleware, getCurrentUser);
router.patch("/me", authMiddleware, updateCurrentUserProfile);

export default router;
