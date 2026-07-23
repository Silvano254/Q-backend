import { rateLimit } from 'express-rate-limit';

// Fallback message for rate limited users
const rateLimitMessage = (msg: string) => ({
  success: false,
  message: `${msg}. Please try again later.`
});

// 1. Authentication Limiter (Login attempts)
// Max 5 attempts per 15 minutes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: rateLimitMessage("Too many login attempts from this IP"),
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. OTP/PIN Request Limiter
// Max 3 requests per 15 minutes
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: rateLimitMessage("Too many verification PIN requests from this IP"),
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. AI Generation Limiter
// Max 10 requests per hour
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: rateLimitMessage("AI recommendation quota exceeded for this hour"),
  standardHeaders: true,
  legacyHeaders: false,
});

// 4. Email Sending Limiter
// Max 5 emails per hour
export const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: rateLimitMessage("Email sending limit reached for this hour"),
  standardHeaders: true,
  legacyHeaders: false,
});

// 5. Database Reset Limiter
// Max 3 resets per hour
export const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: rateLimitMessage("Too many database reset requests"),
  standardHeaders: true,
  legacyHeaders: false,
});

// 6. Global API Limiter
// Max 100 requests per 15 minutes
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: rateLimitMessage("Too many requests from this IP"),
  standardHeaders: true,
  legacyHeaders: false,
});
