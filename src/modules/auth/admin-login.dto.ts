import { z } from 'zod'

export const adminLoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export type AdminLoginInput = z.infer<typeof adminLoginDto>
