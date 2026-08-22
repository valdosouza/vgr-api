import { OAuth2Client } from 'google-auth-library'
import { LoginProvider, VerifiedProviderIdentity } from '@modules/accounts/account.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Verifies a raw client token against the provider and returns an
 * ALREADY-VERIFIED identity — the only thing `account.service`'s
 * `loginWithProvider` ever accepts (decision 119: the app plane never
 * trusts a client-supplied claim). One function per provider, dispatched
 * by `verifyProviderToken`; each is the single place its SDK is touched
 * (decision 143 — no provider SDK inside a domain module).
 *
 * Apple and Facebook are not built yet (decision 152 — no OAuth
 * credentials exist for them); `NOT_AVAILABLE` fails closed instead of
 * leaving the route silently broken.
 */

function unauthorized(): HttpError {
  return new HttpError(401, 'Invalid provider token', undefined, ErrorCodes.UNAUTHORIZED)
}

function notAvailable(provider: string): HttpError {
  return new HttpError(
    422,
    `${provider} login is not configured`,
    undefined,
    ErrorCodes.NOT_AVAILABLE
  )
}

async function verifyGoogleIdToken(idToken: string): Promise<VerifiedProviderIdentity> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) throw notAvailable('google')
  const client = new OAuth2Client(clientId)

  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId })
    payload = ticket.getPayload()
  } catch {
    throw unauthorized()
  }
  if (!payload || !payload.sub) throw unauthorized()

  return {
    provider: 'google',
    sub: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified ?? false,
    displayName: payload.name ?? null,
    // Google has no private-relay concept — only Apple does (decision 121).
    isPrivateRelayEmail: false,
  }
}

export async function verifyProviderToken(
  provider: LoginProvider,
  idToken: string
): Promise<VerifiedProviderIdentity> {
  switch (provider) {
    case 'google':
      return verifyGoogleIdToken(idToken)
    case 'apple':
      throw notAvailable('apple')
    case 'facebook':
      throw notAvailable('facebook')
    default:
      throw unauthorized()
  }
}
