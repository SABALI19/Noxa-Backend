import crypto from "node:crypto";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createError, sendItem } from "../utils/http.js";
import {
  getTokenExpiryDate,
  signLoginOtpToken,
  signAccessToken,
  signRefreshToken,
  verifyLoginOtpToken,
  verifyRefreshToken,
} from "../utils/token.js";
import { assertRequired } from "../utils/validation.js";
import {
  getPublicVapidKey,
  removeUserPushSubscription,
  upsertUserPushSubscription,
} from "../utils/webPush.js";
import {
  isMailConfigured,
  sendAccountCreatedEmail,
  sendLoginOtpEmail,
  sendPasswordResetOtpEmail,
} from "../utils/mailer.js";
import { emitNotification } from "../utils/emitNotification.js";
import { createAndSaveOtp, OTP_PURPOSES, verifyOtpForUser } from "../utils/otp.js";

const USERNAME_REGEX = /^[a-z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const AVATAR_URL_REGEX = /^https?:\/\/\S+$/i;
const AVATAR_DATA_URI_PREFIX = "data:image/";
const MAX_AVATAR_LENGTH = 8 * 1024 * 1024;
const MAX_RINGTONE_NAME_LENGTH = 80;
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
const PASSWORD_RESET_OTP_MINUTES = Number.parseInt(process.env.OTP_EXPIRY_MINUTES || "10", 10);
const LOGIN_OTP_MINUTES = Number.parseInt(
  process.env.LOGIN_OTP_EXPIRY_MINUTES || process.env.OTP_EXPIRY_MINUTES || "10",
  10
);
const isSignupEmailRequired =
  String(process.env.SIGNUP_EMAIL_REQUIRED || "false").trim().toLowerCase() === "true";
const isLoginOtpRequired =
  String(process.env.LOGIN_OTP_REQUIRED || "false").trim().toLowerCase() === "true";

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

const buildLoginSuccessResponse = async (req, user) => {
  const { accessToken, refreshToken } = await issueTokensForUser(user);

  const loginNotification = emitNotification(
    req,
    {
      eventId: `user_logged_in_${user._id}_${Date.now()}`,
      notificationType: "user_logged_in",
      itemType: "account",
      item: {
        id: String(user._id),
        title: user.username,
      },
      message: `Welcome back ${user.username}, you logged in successfully.`,
    },
    { userId: String(user._id) }
  );

  return {
    user: user.toJSON(),
    token: accessToken,
    accessToken,
    refreshToken,
    message: "Login successful",
    notification: loginNotification,
  };
};

const normalizeSignupPayload = (payload) => {
  assertRequired(payload, ["email", "password"]);

  const usernameInput = payload.username ?? payload.name;
  if (!usernameInput) {
    throw createError(400, "username or name is required");
  }

  const username = String(usernameInput).toLowerCase().trim().replace(/\s+/g, "_");
  const name = String(payload.name ?? usernameInput ?? "").trim().slice(0, 80);
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

  return { username, name, email, password };
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

const normalizeLoginOtpVerificationPayload = (payload) => {
  assertRequired(payload, ["loginOtpToken", "otp"]);

  const loginOtpToken = String(payload.loginOtpToken || payload.token || "").trim();
  const otp = String(payload.otp || payload.code || "").trim();

  if (!loginOtpToken) {
    throw createError(400, "loginOtpToken is required");
  }

  if (!otp) {
    throw createError(400, "otp is required");
  }

  return { loginOtpToken, otp };
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
  const otp = String(payload?.otp ?? payload?.code ?? "").trim();
  const email = String(payload?.email ?? "").toLowerCase().trim();
  const password = String(payload?.password ?? payload?.newPassword ?? "");
  const confirmPassword =
    payload?.confirmPassword === undefined || payload?.confirmPassword === null
      ? null
      : String(payload.confirmPassword);

  if (!token && (!email || !otp)) {
    throw createError(400, "token or email plus otp is required");
  }

  if (email && !EMAIL_REGEX.test(email)) {
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

  if (confirmPassword !== null && confirmPassword !== password) {
    throw createError(400, "password confirmation does not match");
  }

  return { token, otp, email, password };
};

const normalizeProfileUpdatePayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw createError(400, "Request body is required");
  }

  const updates = {};

  if (payload.username !== undefined) {
    const username = String(payload.username).toLowerCase().trim().replace(/\s+/g, "_");

    if (username.length < 3 || username.length > 30) {
      throw createError(400, "username must be between 3 and 30 characters");
    }

    if (!USERNAME_REGEX.test(username)) {
      throw createError(400, "username can only contain lowercase letters, numbers, and underscores");
    }

    updates.username = username;
  }

  if (payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (name.length > 80) {
      throw createError(400, "name must be at most 80 characters");
    }
    updates.name = name;
  }

  if (payload.email !== undefined) {
    const email = String(payload.email).toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) {
      throw createError(400, "email must be a valid email address");
    }
    updates.email = email;
  }

  if (payload.avatar !== undefined) {
    const rawAvatar = payload.avatar;
    if (rawAvatar === null || String(rawAvatar).trim() === "") {
      updates.avatar = null;
    } else {
      const avatar = String(rawAvatar).trim();
      if (avatar.length > MAX_AVATAR_LENGTH) {
        throw createError(400, "avatar is too large");
      }

      const isDataUri = avatar.startsWith(AVATAR_DATA_URI_PREFIX);
      const isHttpUrl = AVATAR_URL_REGEX.test(avatar);
      if (!isDataUri && !isHttpUrl) {
        throw createError(400, "avatar must be an image URL or data URI");
      }

      updates.avatar = avatar;
    }
  }

  if (payload.selectedRingtone !== undefined) {
    const selectedRingtone = String(payload.selectedRingtone || "").trim();
    if (!selectedRingtone) {
      throw createError(400, "selectedRingtone must not be empty");
    }
    if (selectedRingtone.length > MAX_RINGTONE_NAME_LENGTH) {
      throw createError(400, "selectedRingtone is too long");
    }
    updates.selectedRingtone = selectedRingtone;
  }

  if (Object.keys(updates).length === 0) {
    throw createError(400, "At least one profile field is required");
  }

  return updates;
};

export const registerUser = asyncHandler(async (req, res) => {
  const { username, name, email, password } = normalizeSignupPayload(req.body);

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
      name,
      email,
      password,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw createError(409, "Email or username already exists");
    }

    throw error;
  }

  let confirmationEmailSent = false;
  const signupEmailConfigured = isMailConfigured();
  const signupEmailPayload = {
    to: user.email,
    username: user.username,
  };

  if (isSignupEmailRequired) {
    try {
      const emailResult = await sendAccountCreatedEmail(signupEmailPayload);
      confirmationEmailSent = Boolean(emailResult?.sent);

      if (!emailResult?.sent) {
        throw createError(503, "Could not send confirmation email. Please try again.");
      }
    } catch (error) {
      console.error("Failed to send account creation email:", error.message);
      await User.findByIdAndDelete(user._id);
      if (error?.statusCode) {
        throw error;
      }
      throw createError(503, "Could not send confirmation email. Please try again.");
    }
  } else if (signupEmailConfigured) {
    // Non-blocking mode: do not delay signup response on SMTP latency.
    void sendAccountCreatedEmail(signupEmailPayload)
      .then((emailResult) => {
        if (!emailResult?.sent && !emailResult?.skipped) {
          console.warn("Could not send signup confirmation email (non-blocking mode).");
        }
      })
      .catch((error) => {
        console.error("Failed to send account creation email:", error.message);
      });
  }

  const confirmationEmailQueued = !isSignupEmailRequired && signupEmailConfigured;

  const { accessToken, refreshToken } = await issueTokensForUser(user);

  const signupNotification = emitNotification(
    req,
    {
      eventId: `account_created_${user._id}_${Date.now()}`,
      notificationType: "account_created",
      itemType: "account",
      item: {
        id: String(user._id),
        title: user.username,
      },
      message: `Welcome ${user.username}, your account was created successfully.`,
    },
    { userId: String(user._id) }
  );

  return sendItem(
    res,
    {
      user: user.toJSON(),
      token: accessToken,
      accessToken,
      refreshToken,
      confirmationEmailSent,
      confirmationEmailQueued,
      message: "Signup successful",
      notification: signupNotification,
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

  if (isLoginOtpRequired) {
    if (!isMailConfigured()) {
      throw createError(503, "Login OTP email is not configured");
    }

    const otpExpiryMinutes =
      Number.isFinite(LOGIN_OTP_MINUTES) && LOGIN_OTP_MINUTES > 0 ? LOGIN_OTP_MINUTES : 10;
    const { otp, doc } = await createAndSaveOtp(user._id, otpExpiryMinutes, OTP_PURPOSES.LOGIN);
    const emailResult = await sendLoginOtpEmail({
      to: user.email,
      username: user.username,
      otp,
      expiresInMinutes: otpExpiryMinutes,
    });

    if (!emailResult?.sent) {
      throw createError(503, "Could not send login OTP. Please try again.");
    }

    const responseData = {
      requiresOtp: true,
      loginOtpToken: signLoginOtpToken(user._id.toString(), otpExpiryMinutes),
      expiresAt: doc.expiresAt,
      message: "Login OTP sent. Verify it to complete sign in.",
    };

    if (process.env.NODE_ENV !== "production") {
      responseData.loginOtp = otp;
      console.info(`Login OTP for ${email}: ${otp}`);
    }

    return sendItem(res, responseData);
  }

  return sendItem(res, await buildLoginSuccessResponse(req, user));
});

export const verifyLoginOtp = asyncHandler(async (req, res) => {
  if (!isLoginOtpRequired) {
    throw createError(400, "Login OTP is not enabled");
  }

  const { loginOtpToken, otp } = normalizeLoginOtpVerificationPayload(req.body);

  let payload;
  try {
    payload = verifyLoginOtpToken(loginOtpToken);
  } catch (_error) {
    throw createError(401, "Invalid or expired login OTP token");
  }

  if (!payload?.sub || payload?.type !== "login_otp") {
    throw createError(401, "Invalid login OTP token payload");
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw createError(404, "User does not exist");
  }

  const otpResult = await verifyOtpForUser(user._id, otp, OTP_PURPOSES.LOGIN);
  if (!otpResult.valid) {
    throw createError(400, "Invalid or expired login OTP");
  }

  return sendItem(res, await buildLoginSuccessResponse(req, user));
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = normalizeForgotPasswordPayload(req.body);
  const genericMessage = "If an account exists, a reset OTP has been sent.";

  const user = await User.findOne({ email });
  if (!user) {
    return sendItem(res, { message: genericMessage });
  }

  const otpExpiryMinutes =
    Number.isFinite(PASSWORD_RESET_OTP_MINUTES) && PASSWORD_RESET_OTP_MINUTES > 0
      ? PASSWORD_RESET_OTP_MINUTES
      : 10;
  const { otp, doc } = await createAndSaveOtp(
    user._id,
    otpExpiryMinutes,
    OTP_PURPOSES.PASSWORD_RESET
  );

  // Keep the old token fields clear so the OTP flow remains the single active reset method.
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  await user.save();

  if (isMailConfigured()) {
    const emailResult = await sendPasswordResetOtpEmail({
      to: user.email,
      username: user.username,
      otp,
      expiresInMinutes: otpExpiryMinutes,
    });

    if (!emailResult?.sent && !emailResult?.skipped) {
      throw createError(503, "Could not send reset OTP. Please try again.");
    }
  }

  const responseData = { message: genericMessage };

  if (process.env.NODE_ENV !== "production") {
    // Local development can use the raw OTP directly when SMTP delivery is unavailable.
    responseData.resetOtp = otp;
    responseData.expiresAt = doc.expiresAt;
    console.info(`Password reset OTP for ${email}: ${otp}`);
  }

  return sendItem(res, responseData);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, otp, email, password } = normalizeResetPasswordPayload(req.body);

  let user;

  if (token) {
    const resetTokenHash = hashToken(token);
    user = await User.findOne({ passwordResetTokenHash: resetTokenHash });

    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() <= Date.now()) {
      throw createError(400, "Invalid or expired reset token");
    }
  } else {
    user = await User.findOne({ email });
    if (!user) {
      throw createError(400, "Invalid or expired OTP");
    }

    const otpResult = await verifyOtpForUser(user._id, otp, OTP_PURPOSES.PASSWORD_RESET);
    if (!otpResult.valid) {
      throw createError(400, "Invalid or expired OTP");
    }
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

export const updateCurrentUserProfile = asyncHandler(async (req, res) => {
  const updates = normalizeProfileUpdatePayload(req.body);
  const updateKeys = Object.keys(updates);
  const isSelectedRingtoneOnlyUpdate =
    updateKeys.length === 1 && updateKeys[0] === "selectedRingtone";

  const user = await User.findById(req.user.id);
  if (!user) {
    throw createError(404, "User not found");
  }

  if (updates.username && updates.username !== user.username) {
    const existingUser = await User.findOne({
      username: updates.username,
      _id: { $ne: user._id },
    }).select("_id");
    if (existingUser) {
      throw createError(409, "Username already exists");
    }
  }

  if (updates.email && updates.email !== user.email) {
    const existingUser = await User.findOne({
      email: updates.email,
      _id: { $ne: user._id },
    }).select("_id");
    if (existingUser) {
      throw createError(409, "Email already exists");
    }
  }

  Object.assign(user, updates);

  try {
    await user.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw createError(409, "Email or username already exists");
    }
    throw error;
  }

  const profileNotification = isSelectedRingtoneOnlyUpdate
    ? null
    : emitNotification(
        req,
        {
          eventId: `profile_updated_${user._id}_${Date.now()}`,
          notificationType: "profile_updated",
          itemType: "profile",
          item: {
            id: String(user._id),
            title: user.username,
          },
          message: "Your profile was updated successfully.",
        },
        { userId: String(user._id) }
      );

  return sendItem(res, {
    user: user.toJSON(),
    message: "Profile updated successfully",
    notification: profileNotification,
  });
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
