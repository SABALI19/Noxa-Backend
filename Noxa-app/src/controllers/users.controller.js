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

const USERNAME_REGEX = /^[a-z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    throw createError(400, "password must be at least 8 characters");
  }

  if (confirmPassword !== null && password !== confirmPassword) {
    throw createError(400, "password and confirmPassword must match");
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

  const { accessToken, refreshToken } = await issueTokensForUser(user);

  return sendItem(
    res,
    {
      user: user.toJSON(),
      token: accessToken,
      accessToken,
      refreshToken,
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
