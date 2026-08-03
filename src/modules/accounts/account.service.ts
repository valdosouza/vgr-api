import bcrypt from 'bcryptjs'
import * as repository from '@modules/accounts/account.repository'
import {
  AppSession,
  UserAccountRow,
  VerifiedProviderIdentity,
} from '@modules/accounts/account.interface'
import {
  generateRefreshToken,
  hashRefreshToken,
  newRefreshFamily,
  refreshExpiryDate,
  signAppAccessToken,
} from '@shared/auth/app-session'
import { decryptEnvelope } from '@shared/crypto/envelope'
import { computeLoginDelayMs, sleep } from '@shared/security/login-delay'
import { verifyTotp } from '@shared/security/totp'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * App user accounts — reporters and helpers (decisions 119-124).
 *
 * The rule that shapes this whole module is decision 123: **the report
 * never waits**. Signing up and reporting demand nothing beyond consent;
 * identity verification is required only before actions with
 * consequences (offering/claiming a reward, becoming a responder).
 */

function invalidCredentials(): HttpError {
  return new HttpError(401, 'Invalid email or password', undefined, ErrorCodes.UNAUTHORIZED)
}

async function issueSession(account: UserAccountRow, familyId?: string): Promise<AppSession> {
  const refreshToken = generateRefreshToken()
  await repository.insertRefreshToken({
    accountId: account.id,
    familyId: familyId ?? newRefreshFamily(),
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshExpiryDate(),
  })
  return {
    accessToken: signAppAccessToken(account.id, account.sessionVersion),
    refreshToken,
    accountId: account.id,
  }
}

// --------------------------------------------------------- registration

export async function registerWithPassword(input: {
  displayName: string
  email: string
  password: string
  consentVersion: string
}): Promise<AppSession> {
  const existing = await repository.findAccountByEmail(input.email)
  if (existing) {
    // Deliberately explicit: unlike login, "this email is taken" is not a
    // secret — the person is choosing an identifier, and hiding it would
    // only make them retry blindly.
    throw new HttpError(409, 'Email already registered', undefined, ErrorCodes.DUPLICATE)
  }

  const passwordHash = await bcrypt.hash(input.password, 10)
  const id = await repository.insertAccount({
    displayName: input.displayName,
    email: input.email,
    passwordHash,
    consentVersion: input.consentVersion,
  })
  await repository.linkProvider({
    accountId: id,
    provider: 'password',
    providerSub: input.email,
    email: input.email,
    emailVerified: false,
  })

  const account = await repository.findAccountById(id)
  if (!account) {
    throw new HttpError(500, 'Account not persisted', undefined, ErrorCodes.INTERNAL)
  }
  // No email verification gate here — decision 123.
  return issueSession(account)
}

// ---------------------------------------------------------------- login

export async function loginWithPassword(
  email: string,
  password: string,
  totpCode?: string
): Promise<AppSession> {
  const account = await repository.findAccountByEmail(email)
  if (!account || !account.passwordHash) {
    // A social-only account has no local password: same generic 401, so
    // the response never reveals which providers an email uses.
    throw invalidCredentials()
  }

  // Same per-account progressive delay as the panel (decision 113).
  const delayMs = computeLoginDelayMs(account.failedLoginCount)
  if (delayMs > 0) await sleep(delayMs)

  if (!(await bcrypt.compare(password, account.passwordHash))) {
    await repository.registerFailedLogin(account.id)
    throw invalidCredentials()
  }
  if (!account.active) throw invalidCredentials()

  // Optional TOTP for app users (decision 124) — the account's, not the
  // method's: it guards this login and any other the account enables.
  if (account.totpEnabled && account.totpSecret) {
    if (!totpCode || !verifyTotp(decryptEnvelope(account.totpSecret), totpCode)) {
      await repository.registerFailedLogin(account.id)
      throw new HttpError(401, 'Two-factor code required', undefined, ErrorCodes.TWO_FACTOR_REQUIRED)
    }
  }

  await repository.clearFailedLogins(account.id)
  return issueSession(account)
}

// ------------------------------------------------------------- provider

/**
 * Social login (decisions 119-121). The caller hands over an identity
 * ALREADY verified against the provider — this service never trusts a raw
 * client token, and the provider token is never stored.
 *
 * Linking rule (decision 121): an existing account is joined automatically
 * only when the email is verified on BOTH sides. Anything less creates or
 * keeps separate accounts rather than risking a takeover.
 */
export async function loginWithProvider(
  identity: VerifiedProviderIdentity
): Promise<AppSession & { requiresPasswordToLink?: boolean }> {
  const known = await repository.findProviderIdentity(identity.provider, identity.sub)
  if (known) {
    const account = await repository.findAccountById(known.accountId)
    if (!account || !account.active) throw invalidCredentials()
    return issueSession(account)
  }

  const canAutoLink =
    identity.email !== null && identity.emailVerified && !identity.isPrivateRelayEmail

  if (canAutoLink) {
    const existing = await repository.findAccountByEmail(identity.email!)
    if (existing) {
      if (!existing.emailVerified) {
        // Both sides must be verified. The local account is not, so this
        // could be someone claiming an email they never proved — the app
        // must ask for the password before joining the accounts.
        throw new HttpError(
          409,
          'Confirm your password to link this login to the existing account',
          undefined,
          ErrorCodes.BUSINESS_RULE,
          { reason: 'link_requires_password' }
        )
      }
      await repository.linkProvider({
        accountId: existing.id,
        provider: identity.provider,
        providerSub: identity.sub,
        email: identity.email,
        emailVerified: true,
      })
      return issueSession(existing)
    }
  }

  // New account. Private-relay and unverified emails still create an
  // account — they just never auto-join an existing one.
  const id = await repository.insertAccount({
    displayName: identity.displayName ?? '',
    email: identity.isPrivateRelayEmail ? null : identity.email,
    passwordHash: null,
    consentVersion: 'provider-implicit',
  })
  await repository.linkProvider({
    accountId: id,
    provider: identity.provider,
    providerSub: identity.sub,
    email: identity.email,
    emailVerified: identity.emailVerified,
  })
  if (identity.emailVerified && !identity.isPrivateRelayEmail) {
    await repository.markEmailVerified(id)
  }

  const account = await repository.findAccountById(id)
  if (!account) {
    throw new HttpError(500, 'Account not persisted', undefined, ErrorCodes.INTERNAL)
  }
  return issueSession(account)
}

/** Manual link from inside an authenticated session (decision 121). */
export async function linkProviderToAccount(
  accountId: number,
  identity: VerifiedProviderIdentity
): Promise<void> {
  const alreadyUsed = await repository.findProviderIdentity(identity.provider, identity.sub)
  if (alreadyUsed && alreadyUsed.accountId !== accountId) {
    throw new HttpError(
      409,
      'This login is already linked to another account',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }
  await repository.linkProvider({
    accountId,
    provider: identity.provider,
    providerSub: identity.sub,
    email: identity.email,
    emailVerified: identity.emailVerified,
  })
}

/** Unlinking must never leave the account with no way in (decision 121). */
export async function unlinkProviderFromAccount(
  accountId: number,
  provider: VerifiedProviderIdentity['provider']
): Promise<void> {
  const providers = await repository.listProvidersOfAccount(accountId)
  if (providers.length <= 1) {
    throw new HttpError(
      409,
      'You cannot remove your only sign-in method',
      undefined,
      ErrorCodes.SELF_LOCKOUT
    )
  }
  await repository.unlinkProvider(accountId, provider)
}

// -------------------------------------------------------------- session

/**
 * Refresh rotation with reuse detection (decision 122). A token already
 * used is the classic fingerprint of theft: the whole family dies, which
 * logs out the attacker AND the legitimate device — the safe outcome,
 * because at that point we cannot tell which is which.
 */
export async function refreshSession(refreshToken: string): Promise<AppSession> {
  const stored = await repository.findRefreshToken(hashRefreshToken(refreshToken))
  if (!stored) throw invalidCredentials()

  if (stored.usedAt !== null) {
    await repository.revokeRefreshFamily(stored.familyId)
    await repository.bumpSessionVersion(stored.accountId)
    throw new HttpError(
      401,
      'Refresh token reuse detected — all sessions revoked',
      undefined,
      ErrorCodes.UNAUTHORIZED
    )
  }
  if (stored.revokedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
    throw invalidCredentials()
  }

  const account = await repository.findAccountById(stored.accountId)
  if (!account || !account.active) throw invalidCredentials()

  await repository.markRefreshTokenUsed(stored.id)
  return issueSession(account, stored.familyId)
}

/** Sign out everywhere: kills access tokens (<=cache TTL) and refreshes. */
export async function revokeAllSessions(accountId: number): Promise<void> {
  await repository.bumpSessionVersion(accountId)
  await repository.revokeAllRefreshTokens(accountId)
}

// ----------------------------------------------------------- assurance

/**
 * The gate of decision 123: consequential actions require a verified
 * identity, everything else does not. Domain services call this right
 * before offering a reward, claiming one, or requesting responder status
 * — never on the reporting path.
 */
export async function assertVerifiedForConsequentialAction(accountId: number): Promise<void> {
  const account = await repository.findAccountById(accountId)
  if (!account) {
    throw new HttpError(404, 'Account not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (!account.emailVerified && !account.phoneVerified) {
    throw new HttpError(
      403,
      'Verify your email or phone before this action',
      undefined,
      ErrorCodes.BUSINESS_RULE,
      { reason: 'verification_required' }
    )
  }
}
