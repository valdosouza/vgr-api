import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as repository from '@modules/auth/admin-account.repository'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

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

  return jwt.sign({ userId: account.id, role: 'admin' }, process.env.JWT_SECRET ?? '', {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '24h') as jwt.SignOptions['expiresIn'],
  })
}
