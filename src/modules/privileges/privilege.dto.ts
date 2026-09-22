import { z } from 'zod'
import { pagedQueryDto } from '@shared/http/paged-query'

/** GET / query (PS0, decision 220): optional page/pageSize, filter on description. */
export const privilegeListQueryDto = pagedQueryDto

export const privilegeSaveDto = z.object({
  // Uppercase identifier: it is referenced by name across API guards and
  // app buttons, so it follows code-identifier rules, not free text.
  description: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Must be an UPPER_SNAKE_CASE identifier'),
})

export type PrivilegeSaveInput = z.infer<typeof privilegeSaveDto>
