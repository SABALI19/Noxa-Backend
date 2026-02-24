import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/constants.js";
import { createError } from "../utils/http.js";

export const authMiddleware = (req, _res, next) => {
  try {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw createError(401, "Authorization token is required");
    }

    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.sub || payload?.type !== "access") {
      throw createError(401, "Invalid token payload");
    }

    req.user = { id: payload.sub };
    next();
  } catch (_error) {
    next(createError(401, "Invalid or expired token"));
  }
};
