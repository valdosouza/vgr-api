import { z } from 'zod'
import { newPasswordSchema } from '@shared/security/password-policy'

const baseUser = {
  name: z.string().min(2).max(120),
  email: z.string().email().max(255),
  active: z.enum(['S', 'N']).default('S'),
  locale: z
    .string()
    .max(10)
    .nullish()
    .transform((v) => v ?? null),
}

export const userCreateDto = z.object({
  ...baseUser,
  // Admin sets the initial password (decision 75 — no e-mail invitation in
  // the MVP). Policy from decision 114; existing passwords stay valid
  // until the next change.
  password: newPasswordSchema,
})

export const userUpdateDto = z.object({
  ...baseUser,
  // Absent = keep the current password (setes users PUT semantics).
  password: newPasswordSchema.optional(),
})

export const userPrivilegesSyncDto = z.object({
  privilegeIds: z.array(z.number().int().positive()),
})

export type UserCreateInput = z.infer<typeof userCreateDto>
export type UserUpdateInput = z.infer<typeof userUpdateDto>
