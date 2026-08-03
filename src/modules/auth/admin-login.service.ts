import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { jwtSecret } from '@shared/config/env'

/** Same message/status whether the email is unknown or the password is
 *  wrong — never reveals which one it was. */
function invalidCredentials(): HttpError {
  return new HttpError(401, 'Invalid email or password', undefined, ErrorCodes.UNAUTHORIZED)
}

export async function authenticateAdmin(email: string, password: string): Promise<string> {
  const account = await repository.findAdminAccountByEmail(email)
  if (!account) {
    throw invalidCredentials()
  }

  const matches = await bcrypt.compare(password, account.passwordHash)
  if (!matches) {
    throw invalidCredentials()
  }

  // Deactivated accounts get the same generic 401 — revealing "inactive"
  // would confirm the email exists.
  if (account.active !== 'S') {
    throw invalidCredentials()
  }

  await repository.registerLogin(account.id)

  // `role: 'admin'` marks a TEAM user for the mobile-role type union; what
  // the user can actually do is decided per privilege by requirePrivilege
  // (decisions 70/72), never by this field. TTL 24h, no refresh (decision 73).
  return jwt.sign({ userId: account.id, role: 'admin' }, jwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '24h') as jwt.SignOptions['expiresIn'],
  })
}
