/** App user (decisions 119-124) — reporters and helpers, never team users. */
export interface UserAccountRow {
  id: number
  displayName: string
  email: string | null
  emailVerified: boolean
  phone: string | null
  phoneVerified: boolean
  /** Null on social-only accounts — the password policy does not apply to
   *  them (decision 124). */
  passwordHash: string | null
  jurisdiction: string
  consentVersion: string | null
  sessionVersion: number
  failedLoginCount: number
  totpSecret: string | null
  totpEnabled: boolean
  active: boolean
}

export type LoginProvider = 'google' | 'apple' | 'facebook' | 'phone' | 'password'

export interface AccountProviderRow {
  id: number
  accountId: number
  provider: LoginProvider
  providerSub: string
  email: string | null
  emailVerified: boolean
}

/** What a verified provider assertion carries into the domain. Nothing
 *  else from the profile is accepted — minimization (decisions 110/119). */
export interface VerifiedProviderIdentity {
  provider: LoginProvider
  /** Stable per-provider user id. */
  sub: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  /** Apple's private relay address: an alias, never an identity — it must
   *  not auto-link accounts (decision 121). */
  isPrivateRelayEmail: boolean
}

export interface AppSession {
  accessToken: string
  refreshToken: string
  accountId: number
}

export interface RefreshTokenRow {
  id: number
  accountId: number
  familyId: string
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
}
