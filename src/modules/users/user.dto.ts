import { z } from 'zod'
import { newPasswordSchema } from '@shared/security/password-policy'
import { pagedQueryDto } from '@shared/http/paged-query'

/** GET / query (PS0, decision 220): optional page/pageSize, filter on name / email. */
export const userListQueryDto = pagedQueryDto

const baseUser = {
  name: z.string().min(2).max(120),
  email: z.string().email().max(255),
}

const active = z.enum(['S', 'N'])
const locale = z.string().max(10)

export const userCreateDto = z.object({
  ...baseUser,
  active: active.default('S'),
  locale: locale.nullish().transform((v) => v ?? null),
  // Admin sets the initial password (decision 75 — no e-mail invitation in
  // the MVP). Policy from decision 114; existing passwords stay valid
  // until the next change.
  password: newPasswordSchema,
})

/** Decision 230: on an update an ABSENT field keeps what is saved —
 *  `active` (a default here used to reactivate a deactivated user) and
 *  `locale` (it used to be nulled); an explicit `locale: null` clears it. */
export const userUpdateDto = z.object({
  ...baseUser,
  active: active.optional(),
  locale: locale.nullable().optional(),
  // Absent = keep the current password (setes users PUT semantics).
  password: newPasswordSchema.optional(),
})

export const userPrivilegesSyncDto = z.object({
  privilegeIds: z.array(z.number().int().positive()),
})

export type UserCreateInput = z.infer<typeof userCreateDto>
export type UserUpdateInput = z.infer<typeof userUpdateDto>
