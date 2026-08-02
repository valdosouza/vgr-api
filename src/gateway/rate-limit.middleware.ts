import rateLimit from 'express-rate-limit'

/**
 * Generic per-IP rate limit. Reports/help offers are potential abuse
 * targets (spam, flooding) — tune per-route limits once scope-refinement
 * defines the real endpoints.
 */
export const rateLimitMiddleware = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
})
