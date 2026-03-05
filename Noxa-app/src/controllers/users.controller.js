import crypto from "node:crypto";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem } from "../utils/http.js";
import {
  getTokenExpiryDate,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/token.js";
import { assertRequired } from "../utils/validation.js";
import {
  getPublicVapidKey,
  removeUserPushSubscription,
  upsertUserPushSubscription,
} from "../utils/webPush.js";
import { sendAccountCreatedEmail } from "../utils/mailer.js";

const USERNAME_REGEX = /^[a-z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const PASSWORD_RESET_TTL_MINUTES = Number.parseInt(
  process.env.PASSWORD_RESET_TTL_MINUTES || "30",
  10
);
const PASSWORD_RESET_TTL_MS =
  (Number.isFinite(PASSWORD_RESET_TTL_MINUTES) && PASSWORD_RESET_TTL_MINUTES > 0
    ? PASSWORD_RESET_TTL_MINUTES
    : 30) *
  60 *
  1000;

const isDuplicateKeyError = (error) => error?.code === 11000;
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const hashesMatch = (rawToken, storedHash) => {
  if (!storedHash) {
    return false;
  }

  const tokenHash = hashToken(rawToken);
  const left = Buffer.from(tokenHash, "hex");
  const right = Buffer.from(storedHash, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
};

const resolvePasswordResetUrl = (token) => {
  const configuredBaseUrl =
    process.env.PASSWORD_RESET_URL || process.env.CLIENT_URL || "http://localhost:5173/auth";

  try {
    const url = new URL(configuredBaseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  } catch (_error) {
    const separator = configuredBaseUrl.includes("?") ? "&" : "?";
    return `${configuredBaseUrl}${separator}token=${encodeURIComponent(token)}`;
  }
};

const clearRefreshTokenSession = async (user) => {
  user.refreshTokenHash = null;
  user.refreshTokenExpiresAt = null;
  await user.save();
};

const issueTokensForUser = async (user) => {
  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());
  const refreshTokenExpiresAt = getTokenExpiryDate(refreshToken);

  if (!refreshTokenExpiresAt) {
    throw createError(500, "Could not determine refresh token expiry");
  }

  user.refreshTokenHash = hashToken(refreshToken);
  user.refreshTokenExpiresAt = refreshTokenExpiresAt;
  await user.save();

  return { accessToken, refreshToken };
};

const normalizeSignupPayload = (payload) => {
  assertRequired(payload, ["email", "password"]);

  const usernameInput = payload.username ?? payload.name;
  if (!usernameInput) {
    throw createError(400, "username or name is required");
  }

  const username = String(usernameInput).toLowerCase().trim().replace(/\s+/g, "_");
  const email = String(payload.email).toLowerCase().trim();
  const password = String(payload.password);
  const confirmPassword =
    payload.confirmPassword === undefined || payload.confirmPassword === null
      ? null
      : String(payload.confirmPassword);

  if (username.length < 3 || username.length > 30) {
    throw createError(400, "username must be between 3 and 30 characters");
  }

  if (!USERNAME_REGEX.test(username)) {
    throw createError(400, "username can only contain lowercase letters, numbers, and underscores");
  }

  if (!EMAIL_REGEX.test(email)) {
    throw createError(400, "email must be a valid email address");
  }

  if (password.length < 8) {
    throw createError(400, "password must be at least 8 characters long");
  }

  if (!PASSWORD_COMPLEXITY_REGEX.test(password)) {
    throw createError(
      400,
      "password must include at least one uppercase letter, one lowercase letter, and one number"
    );
  }

  if (confirmPassword !== null && password !== confirmPassword) {
    throw createError(400, "password confirmation does not match");
  }

  return { username, email, password };
};

const normalizeLoginPayload = (payload) => {
  assertRequired(payload, ["email", "password"]);

  const email = String(payload.email).toLowerCase().trim();
  const password = String(payload.password);

  if (!EMAIL_REGEX.test(email)) {
    throw createError(400, "email must be a valid email address");
  }

  return { email, password };
};

const normalizeForgotPasswordPayload = (payload) => {
  assertRequired(payload, ["email"]);

  const email = String(payload.email).toLowerCase().trim();
  if (!EMAIL_REGEX.test(email)) {
    throw createError(400, "email must be a valid email address");
  }

  return { email };
};

const normalizeResetPasswordPayload = (payload) => {
  const token = String(payload?.token ?? payload?.resetToken ?? "").trim();
  const password = String(payload?.password ?? payload?.newPassword ?? "");
  const confirmPassword =
    payload?.confirmPassword === undefined || payload?.confirmPassword === null
      ? null
      : String(payload.confirmPassword);

  if (!token) {
    throw createError(400, "token is required");
  }

  if (password.length < 8) {
    throw createError(400, "password must be at least 8 characters long");
  }

  if (!PASSWORD_COMPLEXITY_REGEX.test(password)) {
    throw createError(
      400,
      "password must include at least one uppercase letter, one lowercase letter, and one number"
    );
  }

  if (confirmPassword !== null && confirmPassword !== password) {
    throw createError(400, "password confirmation does not match");
  }

  return { token, password };
};

export const registerUser = asyncHandler(async (req, res) => {
  const { username, email, password } = normalizeSignupPayload(req.body);

  const existing = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (existing) {
    throw createError(409, "Email or username already exists");
  }

  let user;
  try {
    user = await User.create({
      username,
      email,
      password,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw createError(409, "Email or username already exists");
    }

    throw error;
  }

  // Email confirmation is mandatory for account creation.
  try {
    const emailResult = await sendAccountCreatedEmail({
      to: user.email,
      username: user.username,
    });
    if (!emailResult?.sent) {
      throw createError(503, "Could not send confirmation email. Please try again.");
    }
  } catch (error) {
    // Roll back user creation if confirmation email fails.
    await User.findByIdAndDelete(user._id);
    if (error?.statusCode) {
      throw error;
    }
    console.error("Failed to send account creation email:", error.message);
    throw createError(503, "Could not send confirmation email. Please try again.");
  }

  const { accessToken, refreshToken } = await issueTokensForUser(user);

  return sendItem(
    res,
    {
      user: user.toJSON(),
      token: accessToken,
      accessToken,
      refreshToken,
      confirmationEmailSent: true,
    },
    201
  );
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = normalizeLoginPayload(req.body);
  const user = await User.findOne({ email });
  if (!user) {
    throw createError(404, "User does not exist");
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw createError(401, "Incorrect password");
  }

  const { accessToken, refreshToken } = await issueTokensForUser(user);

  return sendItem(res, {
    user: user.toJSON(),
    token: accessToken,
    accessToken,
    refreshToken,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = normalizeForgotPasswordPayload(req.body);
  const genericMessage = "If an account exists, a reset link has been sent.";

  const user = await User.findOne({ email });
  if (!user) {
    return sendItem(res, { message: genericMessage });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetUrl = resolvePasswordResetUrl(resetToken);

  user.passwordResetTokenHash = hashToken(resetToken);
  user.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await user.save();

  const responseData = { message: genericMessage };

  if (process.env.NODE_ENV !== "production") {
    responseData.resetToken = resetToken;
    responseData.resetUrl = resetUrl;
    responseData.expiresAt = user.passwordResetExpiresAt;
    console.info(`Password reset link for ${email}: ${resetUrl}`);
  }

  return sendItem(res, responseData);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = normalizeResetPasswordPayload(req.body);
  const resetTokenHash = hashToken(token);

  const user = await User.findOne({ passwordResetTokenHash: resetTokenHash });
  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() <= Date.now()) {
    throw createError(400, "Invalid or expired reset token");
  }

  user.password = password;
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.refreshTokenHash = null;
  user.refreshTokenExpiresAt = null;
  await user.save();

  return sendItem(res, {
    message: "Password reset successful. Please sign in.",
  });
});

export const refreshAuthToken = asyncHandler(async (req, res) => {
  assertRequired(req.body, ["refreshToken"]);
  const refreshToken = String(req.body.refreshToken).trim();

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    throw createError(401, "Invalid or expired refresh token");
  }

  if (!payload?.sub || payload?.type !== "refresh") {
    throw createError(401, "Invalid refresh token payload");
  }

  const user = await User.findById(payload.sub);
  if (!user || !hashesMatch(refreshToken, user.refreshTokenHash)) {
    throw createError(401, "Invalid or expired refresh token");
  }

  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt.getTime() <= Date.now()) {
    await clearRefreshTokenSession(user);
    throw createError(401, "Refresh token expired");
  }

  const tokens = await issueTokensForUser(user);

  return sendItem(res, {
    token: tokens.accessToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

export const logoutUser = asyncHandler(async (req, res) => {
  assertRequired(req.body, ["refreshToken"]);
  const refreshToken = String(req.body.refreshToken).trim();
  const refreshTokenHash = hashToken(refreshToken);

  const user = await User.findOne({ refreshTokenHash });
  if (user) {
    await clearRefreshTokenSession(user);
  }

  return sendItem(res, { message: "Logged out" });
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw createError(404, "User not found");
  }

  return sendItem(res, user.toJSON());
});

export const getPushPublicKey = asyncHandler(async (_req, res) => {
  const publicKey = getPublicVapidKey();
  if (!publicKey) {
    throw createError(503, "Push notifications are not configured");
  }

  return sendItem(res, { publicKey });
});

export const subscribePushNotifications = asyncHandler(async (req, res) => {
  assertRequired(req.body, ["subscription"]);

  const subscription = await upsertUserPushSubscription(req.user.id, req.body.subscription);

  return sendItem(res, {
    subscribed: true,
    endpoint: subscription.endpoint,
  });
});

export const unsubscribePushNotifications = asyncHandler(async (req, res) => {
  const endpoint = String(req.body?.endpoint || req.body?.subscription?.endpoint || "").trim();
  await removeUserPushSubscription(req.user.id, endpoint || null);

  return sendItem(res, { subscribed: false });
});
