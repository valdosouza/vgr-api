import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { AuthenticatedUser } from '@shared/types/express'

/**
 * Validates the Bearer JWT on /api/* routes.
 *
 * ⚠️ Payload shape not yet finalized in scope-refinement — today it's just
 * `{ userId, role }` (see decisions 4 and 12 in VGR-plano.md: roles are
 * anonymous/reporter/helper/police). Anonymous reporters and anonymous
 * helpers do NOT go through this middleware — only routes that require
 * identity (e.g. claiming a reward) should require a token.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' })
    return
  }

  const token = header.slice('Bearer '.length)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? '') as AuthenticatedUser
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
