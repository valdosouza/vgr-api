import { NextFunction, Request, Response } from 'express'

/**
 * Gates every admin-configuration endpoint (risk-config, category-forms,
 * panic-responders, dual-control-access, monetization-config — decision
 * 56). Runs after authMiddleware, so req.user is already populated.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}
