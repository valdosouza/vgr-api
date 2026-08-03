import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { AuthenticatedUser } from '@shared/types/express'
import { getSessionInfo } from '@shared/acl/session-store'
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
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  let payload: AuthenticatedUser
  try {
    payload = jwt.verify(token, secret) as AuthenticatedUser
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  // Session revocation check (decision 112): the token's `sv` claim must
  // match tb_user.session_version (60s cache). Bumping the version —
  // deactivation, password change, "drop sessions" — kills every
  // outstanding token in <=60s. Fails closed on lookup error, same
  // posture as requirePrivilege (decision 72).
  try {
    const session = await getSessionInfo(payload.userId)
    if (!session || !session.active || session.sessionVersion !== payload.sv) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }
  } catch (err) {
    logger.error('Session lookup failed — failing closed', { err })
    res.status(500).json({ error: 'Internal error', code: 'INTERNAL' })
    return
  }

  req.user = payload
  next()
}
