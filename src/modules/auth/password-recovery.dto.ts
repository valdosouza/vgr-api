import { z } from 'zod'
import { newPasswordSchema } from '@shared/security/password-policy'

export const recoveryPasswordDto = z.object({
  email: z.string().email(),
})

export const changePasswordDto = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Must be the 6-digit code'),
  // Same policy as the Users screen (decision 114).
  newPassword: newPasswordSchema,
})

export type RecoveryPasswordInput = z.infer<typeof recoveryPasswordDto>
export type ChangePasswordInput = z.infer<typeof changePasswordDto>
