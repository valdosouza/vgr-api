import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import * as repository from '@modules/auth/admin-account.repository'
import { signSession, verifyEnrollToken } from '@modules/auth/admin-login.service'
import { invalidateSession } from '@shared/acl/session-store'
import { decryptEnvelope, encryptEnvelope } from '@shared/crypto/envelope'
import { generateTotpSecret, totpUri, verifyTotp } from '@shared/security/totp'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * TOTP enrollment and recovery (decision 114). Enrollment endpoints accept
 * only the short-lived enroll-scope token issued by login — a full session
 * does not exist before 2FA is active, and the enroll token opens nothing
 * but these endpoints.
 */

function unauthorized(): HttpError {
  return new HttpError(401, 'Invalid or expired code', undefined, ErrorCodes.UNAUTHORIZED)
}

/** Step 1: generate + store (disabled) and hand the panel the QR URI. */
export async function startEnrollment(
  enrollToken: string
): Promise<{ secret: string; otpauthUri: string }> {
  const userId = verifyEnrollToken(enrollToken)
  const account = await repository.findAdminAccountById(userId)
  if (!account || account.active !== 'S') throw unauthorized()

  const secret = generateTotpSecret()
  await repository.setTotpSecret(userId, encryptEnvelope(secret))
  return { secret, otpauthUri: totpUri(secret, account.email) }
}

/** Step 2: first valid code activates 2FA, mints the one-time recovery
 *  codes (shown once, stored hashed) and finally opens a full session. */
export async function activateEnrollment(
  enrollToken: string,
  code: string
): Promise<{ jwt: string; recoveryCodes: string[] }> {
  const userId = verifyEnrollToken(enrollToken)
  const account = await repository.findAdminAccountById(userId)
  if (!account || account.active !== 'S' || !account.totpSecret) throw unauthorized()

  if (!verifyTotp(decryptEnvelope(account.totpSecret), code)) {
    throw unauthorized()
  }

  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(5).toString('hex').toUpperCase()
  )
  const hashes = await Promise.all(recoveryCodes.map((value) => bcrypt.hash(value, 10)))
  await repository.replaceRecoveryCodes(userId, hashes)
  await repository.enableTotp(userId)
  invalidateSession(userId)

  return { jwt: signSession(userId, account.sessionVersion), recoveryCodes }
}

/**
 * "Lost my phone": one unused recovery code opens a session AND clears
 * TOTP, forcing re-enrollment on the next login. An admin with neither
 * codes nor device is unlocked by ANOTHER admin through the dual-control
 * reset (decision 114 — never a unilateral shortcut, decision 70).
 */
export async function recoverWithCode(
  email: string,
  password: string,
  recoveryCode: string
): Promise<{ jwt: string }> {
  const account = await repository.findAdminAccountByEmail(email)
  if (!account || account.active !== 'S') throw unauthorized()

  // The recovery code replaces the TOTP factor, never the password.
  const passwordOk = await bcrypt.compare(password, account.passwordHash)
  if (!passwordOk) throw unauthorized()

  const candidates = await repository.listUnusedRecoveryCodes(account.id)
  for (const candidate of candidates) {
    if (await bcrypt.compare(recoveryCode.toUpperCase(), candidate.codeHash)) {
      await repository.markRecoveryCodeUsed(candidate.id)
      await repository.clearTotp(account.id)
      invalidateSession(account.id)
      return { jwt: signSession(account.id, account.sessionVersion) }
    }
  }
  throw unauthorized()
}
