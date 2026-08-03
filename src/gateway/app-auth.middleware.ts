import { NextFunction, Request, Response } from 'express'
import { verifyAppAccessToken } from '@shared/auth/app-session'
import * as accountRepository from '@modules/accounts/account.repository'
import { jwtSecret } from '@shared/config/env'
import { ErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * App-plane authentication (decision 119) — the counterpart of
 * authMiddleware. Rejects panel tokens by audience, and enforces the same
 * session_version revocation the panel uses (decision 122).
 *
 * Anonymous flows never reach this middleware: reporting without an
 * account carries no token at all (decisions 32/35), and its trail is the
 * accountability log (decision 23), not a session.
 */
export async function appAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token', code: ErrorCodes.UNAUTHORIZED })
    return
  }

  try {
    jwtSecret()
  } catch (err) {
    logger.error('JWT_SECRET missing — rejecting all app requests', { err })
    res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
    return
  }

  let payload
  try {
    payload = verifyAppAccessToken(header.slice('Bearer '.length))
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: ErrorCodes.UNAUTHORIZED })
    return
  }

  try {
    const account = await accountRepository.findAccountById(payload.accountId)
    if (!account || !account.active || account.sessionVersion !== payload.sv) {
      res.status(401).json({ error: 'Invalid or expired token', code: ErrorCodes.UNAUTHORIZED })
      return
    }
    req.appAccountId = account.id
    next()
  } catch (err) {
    // Fail closed, same posture as every other guard (decisions 72/104).
    logger.error('App session lookup failed — failing closed', { err })
    res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
  }
}
