import { NextFunction, Request, Response } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'

/**
 * Runs app-plane auth only when a token is present; bare requests proceed
 * anonymous instead of being rejected (decisions 32/35 — reporting and
 * uploading never require an account). A PRESENT-but-invalid token still
 * fails: silently downgrading a broken session to anonymous would hide
 * client bugs and let a revoked account keep acting as "anonymous with a
 * token". Promoted from media.routes when /app-reports became the second
 * consumer.
 */
export function optionalAppAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.headers.authorization) {
    void appAuthMiddleware(req, res, next)
    return
  }
  next()
}
