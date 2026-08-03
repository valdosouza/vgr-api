import { z } from 'zod'

export const recoveryPasswordDto = z.object({
  email: z.string().email(),
})

export const changePasswordDto = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Must be the 6-digit code'),
  // Same minimum as the Users screen (user.dto.ts).
  newPassword: z.string().min(5).max(72),
})

export type RecoveryPasswordInput = z.infer<typeof recoveryPasswordDto>
export type ChangePasswordInput = z.infer<typeof changePasswordDto>
