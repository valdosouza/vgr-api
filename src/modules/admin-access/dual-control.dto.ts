import { z } from 'zod'
import { pagedQueryDto } from '@shared/http/paged-query'

/** Who asks is the session (decision 223) — the body carries only WHAT is
 *  asked and WHY. `legalBasis` fits the column (VARCHAR 500). */
export const dualControlCreateDto = z.object({
  accountabilityLogEntryId: z.number().int().positive(),
  legalBasis: z.string().trim().min(1).max(500),
})

export type DualControlCreateInput = z.infer<typeof dualControlCreateDto>

/** Decision 220 on the request list; `filter` matches the legal basis
 *  (decision 227). Approving takes no body: the approver is the session. */
export const dualControlListQueryDto = pagedQueryDto
