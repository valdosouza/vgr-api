import { z } from 'zod'
import { newPasswordSchema } from '@shared/security/password-policy'

/** Decision 124: same password policy as the panel — one policy in the
 *  code, no exception table. Social accounts have no local password, so
 *  this simply never applies to them. */
export const accountRegisterDto = z.object({
  displayName: z.string().min(2).max(120),
  email: z.string().email().max(255),
  password: newPasswordSchema,
  /** Decision 8 / task 13: registration does not complete without consent. */
  consentVersion: z.string().min(1).max(20),
})

export const accountLoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Only when the account enabled the optional TOTP (decision 124). */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
})

export const refreshDto = z.object({
  refreshToken: z.string().min(20),
})

/** The client sends the provider's raw credential; the server verifies it
 *  and never stores it (decision 119). */
export const providerLoginDto = z.object({
  provider: z.enum(['google', 'apple', 'facebook']),
  idToken: z.string().min(20),
})

export const confirmEmailVerificationDto = z.object({
  code: z.string().regex(/^\d{6}$/),
})

export type AccountRegisterInput = z.infer<typeof accountRegisterDto>
export type AccountLoginInput = z.infer<typeof accountLoginDto>
export type ProviderLoginInput = z.infer<typeof providerLoginDto>
