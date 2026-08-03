import { z } from 'zod'

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
  // the MVP). Same minimum used by the future recovery flow.
  password: z.string().min(5).max(72),
})

export const userUpdateDto = z.object({
  ...baseUser,
  // Absent = keep the current password (setes users PUT semantics).
  password: z.string().min(5).max(72).optional(),
})

export const userPrivilegesSyncDto = z.object({
  privilegeIds: z.array(z.number().int().positive()),
})

export type UserCreateInput = z.infer<typeof userCreateDto>
export type UserUpdateInput = z.infer<typeof userUpdateDto>
