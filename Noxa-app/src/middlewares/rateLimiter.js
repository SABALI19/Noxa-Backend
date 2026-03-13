import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW * 60 * 1000, // e.g. 15 minutes
  max: process.env.RATE_LIMIT_MAX, // limit each IP to 100 requests per windowMs
  message: {
    status: 429,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true, // return rate limit info in the headers
  legacyHeaders: false,
});