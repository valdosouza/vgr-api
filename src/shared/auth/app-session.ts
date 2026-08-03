import { createHash, randomBytes, randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { Audiences } from '@shared/auth/audience'
import { jwtSecret } from '@shared/config/env'

/**
 * App-plane session tokens (decision 122): 30-minute access token plus a
 * rotating 90-day refresh token.
 *
 * The contrast with the panel's 15 minutes is deliberate (decision 119):
 * the panel grants privileges and decrypts life-at-risk data; the app does
 * not. Each plane gets the session its risk deserves.
 */

const ACCESS_TTL = '30m'
export const REFRESH_TTL_DAYS = 90

export interface AppTokenPayload {
  accountId: number
  /** session_version — bumping it in the DB kills every live token. */
  sv: number
}

export function signAppAccessToken(accountId: number, sessionVersion: number): string {
  return jwt.sign({ accountId, sv: sessionVersion }, jwtSecret(), {
    audience: Audiences.APP,
    expiresIn: (process.env.APP_JWT_EXPIRES_IN ?? ACCESS_TTL) as jwt.SignOptions['expiresIn'],
  })
}

/** Throws if the token is invalid, expired, or belongs to the panel plane. */
export function verifyAppAccessToken(token: string): AppTokenPayload {
  return jwt.verify(token, jwtSecret(), { audience: Audiences.APP }) as AppTokenPayload
}

/** Opaque refresh token — random, never a JWT: it must be revocable by
 *  storage, and a self-contained token cannot be revoked. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Only the hash reaches the database (decision 110). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newRefreshFamily(): string {
  return randomUUID()
}

export function refreshExpiryDate(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
}
