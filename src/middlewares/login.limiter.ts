import rateLimit from "express-rate-limit";

// Limit each IP to 5 login attempts per minute
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,               // max 5 attempts
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,  // Disable X-RateLimit-* headers
  message: "Too many login attempts, please try again later.",
});