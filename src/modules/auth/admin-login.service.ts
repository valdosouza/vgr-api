import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { invalidateSession } from '@shared/acl/session-store'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { jwtSecret } from '@shared/config/env'
import { computeLoginDelayMs, sleep } from '@shared/security/login-delay'

/** Same message/status whether the email is unknown or the password is
 *  wrong — never reveals which one it was. */
function invalidCredentials(): HttpError {
  return new HttpError(401, 'Invalid email or password', undefined, ErrorCodes.UNAUTHORIZED)
}

function signSession(userId: number, sessionVersion: number): string {
  // `role: 'admin'` marks a TEAM user for the mobile-role type union; what
  // the user can actually do is decided per privilege by requirePrivilege
  // (decisions 70/72), never by this field. TTL 15m (decision 112); `sv`
  // ties the token to tb_user.session_version — bump it and every
  // outstanding token dies within the session-store cache TTL.
  return jwt.sign({ userId, role: 'admin', sv: sessionVersion }, jwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn'],
  })
}

export async function authenticateAdmin(email: string, password: string): Promise<string> {
  const account = await repository.findAdminAccountByEmail(email)
  if (!account) {
    throw invalidCredentials()
  }

  // Progressive per-account delay (decision 113) BEFORE checking the
  // password, so the cost applies to the attack, not only to the miss.
  // Applied server-side and invisibly: same generic 401 either way.
  const delayMs = computeLoginDelayMs(account.failedLoginCount)
  if (delayMs > 0) {
    await sleep(delayMs)
  }

  const matches = await bcrypt.compare(password, account.passwordHash)
  if (!matches) {
    await repository.registerFailedLogin(account.id)
    throw invalidCredentials()
  }

  // Deactivated accounts get the same generic 401 — revealing "inactive"
  // would confirm the email exists.
  if (account.active !== 'S') {
    throw invalidCredentials()
  }

  await repository.registerLogin(account.id)
  invalidateSession(account.id)

  return signSession(account.id, account.sessionVersion)
}

/**
 * Sliding renewal (decision 112): a still-valid token (authMiddleware ran,
 * including the session_version check) is exchanged for a fresh 15m one.
 * The app calls this near expiry instead of storing credentials.
 */
export async function renewSession(userId: number): Promise<string> {
  const account = await repository.findAdminAccountById(userId)
  if (!account || account.active !== 'S') {
    throw new HttpError(401, 'Invalid or expired token', undefined, ErrorCodes.UNAUTHORIZED)
  }
  return signSession(account.id, account.sessionVersion)
}
