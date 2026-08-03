import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { invalidateSession } from '@shared/acl/session-store'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { jwtSecret } from '@shared/config/env'
import { Audiences } from '@shared/auth/audience'
import { decryptEnvelope } from '@shared/crypto/envelope'
import { computeLoginDelayMs, sleep } from '@shared/security/login-delay'
import { verifyTotp } from '@shared/security/totp'

/** Same message/status whether the email is unknown or the password is
 *  wrong — never reveals which one it was. */
function invalidCredentials(): HttpError {
  return new HttpError(401, 'Invalid email or password', undefined, ErrorCodes.UNAUTHORIZED)
}

export function signSession(userId: number, sessionVersion: number): string {
  // `role: 'admin'` marks a TEAM user for the mobile-role type union; what
  // the user can actually do is decided per privilege by requirePrivilege
  // (decisions 70/72), never by this field. TTL 15m (decision 112); `sv`
  // ties the token to tb_user.session_version — bump it and every
  // outstanding token dies within the session-store cache TTL. `aud`
  // pins the token to the panel plane (decision 119): it is a 401 on any
  // app-plane route, and app tokens are a 401 here.
  return jwt.sign({ userId, role: 'admin', sv: sessionVersion }, jwtSecret(), {
    audience: Audiences.ADMIN,
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn'],
  })
}

/** What the login endpoint returns (decision 114 two-step flow):
 *  - `session`: password (+ TOTP when enabled) accepted — full JWT.
 *  - `enroll`: password accepted but 2FA not yet set up — a short-lived
 *    scope token usable ONLY on the /auth/2fa endpoints. Enrollment is
 *    mandatory: no full session exists before it completes. */
export type LoginResult =
  | { kind: 'session'; jwt: string }
  | { kind: 'enroll'; enrollToken: string }

export function signEnrollToken(userId: number): string {
  return jwt.sign({ userId, scope: '2fa_enroll' }, jwtSecret(), { expiresIn: '10m' })
}

export function verifyEnrollToken(token: string): number {
  try {
    const payload = jwt.verify(token, jwtSecret()) as { userId: number; scope?: string }
    if (payload.scope !== '2fa_enroll') throw new Error('wrong scope')
    return payload.userId
  } catch {
    throw new HttpError(401, 'Invalid or expired enrollment token', undefined, ErrorCodes.UNAUTHORIZED)
  }
}

export async function authenticateAdmin(
  email: string,
  password: string,
  totpCode?: string
): Promise<LoginResult> {
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

  // Second factor (decision 114). A wrong code counts toward the
  // progressive delay too — the second factor is as brute-forceable as
  // the first without it.
  if (account.totpEnabled === 'S' && account.totpSecret) {
    if (!totpCode || !verifyTotp(decryptEnvelope(account.totpSecret), totpCode)) {
      await repository.registerFailedLogin(account.id)
      throw new HttpError(
        401,
        'Two-factor code required',
        undefined,
        ErrorCodes.TWO_FACTOR_REQUIRED
      )
    }
  }

  await repository.registerLogin(account.id)
  invalidateSession(account.id)

  // Mandatory enrollment on first login once the feature exists (114).
  if (account.totpEnabled !== 'S') {
    return { kind: 'enroll', enrollToken: signEnrollToken(account.id) }
  }

  return { kind: 'session', jwt: signSession(account.id, account.sessionVersion) }
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
