import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { AuthenticatedUser } from '@shared/types/express'
import { jwtSecret } from '@shared/config/env'
import logger from '@shared/logger/logger'

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

  // A missing secret is a server misconfiguration (500), never a token
  // problem (401) — and never a verify against '' (finding A2).
  let secret: string
  try {
    secret = jwtSecret()
  } catch (err) {
    logger.error('JWT_SECRET missing — rejecting all authenticated requests', { err })
    res.status(500).json({ error: 'Internal error', code: 'INTERNAL' })
    return
  }

  const token = header.slice('Bearer '.length)
  try {
    const payload = jwt.verify(token, secret) as AuthenticatedUser
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
