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

/**
 * Stricter limit for /auth (login + password recovery): these endpoints are
 * brute-force targets and were previously unprotected — gap flagged in
 * docs/feature/auth.md, closed in phase 2 of the admin-controls plan.
 */
export const authRateLimitMiddleware = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
})
