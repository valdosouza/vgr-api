import { z } from 'zod'
import { pagedQueryDto } from '@shared/http/paged-query'

/** Admin queue GET / (PS0, decision 220): optional page/pageSize only —
 *  the row carries no applicant name/email (the list is not joined), so
 *  a text `filter` has nothing to match and is dropped by the schema. */
export const responderPoolListQueryDto = pagedQueryDto.omit({ filter: true })

export type ResponderPoolListQuery = z.infer<typeof responderPoolListQueryDto>

export const responderPoolRequestDto = z.object({
  criteriaNotes: z.string().optional(),
})

export type ResponderPoolRequestInput = z.infer<typeof responderPoolRequestDto>

export const responderPoolResolveDto = z.object({
  approved: z.boolean(),
})

export type ResponderPoolResolveInput = z.infer<typeof responderPoolResolveDto>
