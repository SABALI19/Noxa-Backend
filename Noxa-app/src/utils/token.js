import jwt from "jsonwebtoken";
import {
  JWT_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
  JWT_REFRESH_SECRET,
  JWT_SECRET,
} from "../config/constants.js";

export const signAccessToken = (userId) => {
  return jwt.sign({ sub: userId, type: "access" }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

export const signRefreshToken = (userId) => {
  return jwt.sign({ sub: userId, type: "refresh" }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });
};

export const signLoginOtpToken = (userId, expiresInMinutes = 10) => {
  const safeMinutes =
    Number.isFinite(Number(expiresInMinutes)) && Number(expiresInMinutes) > 0
      ? Number(expiresInMinutes)
      : 10;

  return jwt.sign({ sub: userId, type: "login_otp" }, JWT_SECRET, {
    expiresIn: `${safeMinutes}m`,
  });
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};

export const verifyLoginOtpToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

export const getTokenExpiryDate = (token) => {
  const payload = jwt.decode(token);
  if (!payload?.exp) {
    return null;
  }

  return new Date(payload.exp * 1000);
};

// Backward-compatible alias for existing imports.
export const signAuthToken = signAccessToken;
