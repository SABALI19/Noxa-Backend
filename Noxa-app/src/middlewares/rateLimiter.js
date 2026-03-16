import rateLimit from "express-rate-limit";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const rateLimitWindowMinutes = parsePositiveInt(process.env.RATE_LIMIT_WINDOW, 5);
const rateLimitMaxRequests = parsePositiveInt(process.env.RATE_LIMIT_MAX, 10);

export const apiLimiter = rateLimit({
  windowMs: rateLimitWindowMinutes * 60 * 1000,
  max: rateLimitMaxRequests,
  message: {
    status: 429,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true, // return rate limit info in the headers
  legacyHeaders: false,
});
