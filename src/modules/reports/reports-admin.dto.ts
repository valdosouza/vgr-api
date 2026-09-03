import { z } from 'zod'
import { CATEGORIES, SUBJECTS } from '@shared/taxonomy/taxonomy'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/**
 * Panel search query (B1 — decision 166: the list is not audited, so it
 * must be cheap and precise). Query params arrive as strings: booleans
 * are the literal `true|false` (a bad value is INVALID_OPTION, decision
 * 83), numbers are coerced, dates accept ISO date-time or `YYYY-MM-DD`
 * (the service turns date-only bounds into whole days).
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const queryBool = z.enum(['true', 'false']).transform((value) => value === 'true')

const queryDate = z.string().refine(
  (value) => DATE_ONLY.test(value) || !Number.isNaN(Date.parse(value)),
  { message: 'Expected ISO date-time or YYYY-MM-DD', params: { code: FieldErrorCodes.INVALID_FORMAT } }
)

export const reportSearchQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  id: z.coerce.number().int().min(1).optional(),
  status: z.enum(['open', 'resolved']).optional(),
  category: z.enum(CATEGORIES).optional(),
  subject: z.enum(SUBJECTS).optional(),
  tier: z.enum(['low', 'medium', 'high']).optional(),
  frozen: queryBool.optional(),
  hasMedia: queryBool.optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
})

export type ReportSearchQuery = z.infer<typeof reportSearchQueryDto>

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}
