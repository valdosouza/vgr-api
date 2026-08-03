import { z } from 'zod'

export const adminLoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Required once the account has 2FA enabled (decision 114). */
  totpCode: z.string().regex(/^\d{6}$/).optional(),
})

export type AdminLoginInput = z.infer<typeof adminLoginDto>
