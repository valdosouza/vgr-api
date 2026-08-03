import { randomInt } from 'crypto'
import bcrypt from 'bcryptjs'
import * as repository from '@modules/auth/admin-account.repository'
import { isMailerConfigured, sendMail } from '@shared/mailer/mailer'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * Password recovery for team users (phase 2 of the admin-controls plan;
 * ported from setes-api's flow, bcrypt instead of MD5). Two steps:
 * 6-digit code by email → change password within the 15-minute window.
 */
const RECOVERY_CODE_TTL_MINUTES = 15

/** Always resolves silently — never reveals whether the email exists. */
export async function recoveryPassword(email: string): Promise<void> {
  const account = await repository.findAdminAccountByEmail(email)
  if (!account || account.active !== 'S') return

  const code = String(randomInt(100000, 1000000))
  await repository.setActivationKey(account.id, code)

  const changeUrl = process.env.APP_CHANGE_PASSWORD_URL ?? 'http://localhost:8080/#/change-password'
  try {
    await sendMail({
      to: email,
      subject: 'VGR — password recovery code',
      text: `Your recovery code is ${code} (valid for ${RECOVERY_CODE_TTL_MINUTES} minutes). Open ${changeUrl} to set a new password.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
          <h2>Password recovery</h2>
          <p>Use the code below to set a new password for the VGR admin panel.
             It is valid for <strong>${RECOVERY_CODE_TTL_MINUTES} minutes</strong>.</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center">${code}</p>
          <p style="text-align:center">
            <a href="${changeUrl}"
               style="background:#1B5E20;color:#fff;padding:12px 24px;
                      border-radius:24px;text-decoration:none;display:inline-block">
              Set new password</a>
          </p>
          <p style="color:#888;font-size:12px">If you did not request this
             recovery, ignore this email — your password stays the same.</p>
        </div>`,
    })
  } catch (err) {
    logger.error('Failed to send recovery email', { email, err })
    // Keep going: the code is stored; in dev it is logged below.
  }

  if (!isMailerConfigured()) {
    logger.info('Password recovery code (dev mode, no SMTP)', { email, code })
  }
}

/** Same generic 401 for unknown email, wrong code and expired code. */
function invalidCode(): HttpError {
  return new HttpError(401, 'Invalid or expired code', undefined, ErrorCodes.UNAUTHORIZED)
}

export async function changePassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const account = await repository.findAdminAccountByEmail(email)
  if (!account) throw invalidCode()

  const info = await repository.getActivationInfo(account.id)
  if (!info || !info.activationKey || info.activationKey !== code) {
    throw invalidCode()
  }
  if (info.ageMinutes > RECOVERY_CODE_TTL_MINUTES) {
    throw invalidCode()
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await repository.updatePassword(account.id, passwordHash)
}
