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

export const queryDate = z.string().refine(
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
  /** Moderation mark (B2, decision 162). */
  hidden: queryBool.optional(),
  /** Review mark (B3, decision 161). */
  reviewed: queryBool.optional(),
  from: queryDate.optional(),
  to: queryDate.optional(),
})

export type ReportSearchQuery = z.infer<typeof reportSearchQueryDto>

/** Proactive queue query (B3 — decision 161): pagination only; the
 *  WHERE and the ORDER BY are fixed by the decision, not by the caller. */
export const reportQueueQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ReportQueueQuery = z.infer<typeof reportQueueQueryDto>

/**
 * Statistics query (B4 — decision 164). Same date rules as the search;
 * the RANGE semantics (defaults, from <= to, max 366 days) live in
 * reports-stats.service because the `to` default is "now".
 */
export const STATS_GRANULARITIES = ['day', 'week', 'month'] as const

export const reportStatsQueryDto = z.object({
  from: queryDate.optional(),
  to: queryDate.optional(),
  granularity: z.enum(STATS_GRANULARITIES).default('day'),
})

export type ReportStatsQuery = z.infer<typeof reportStatsQueryDto>

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}
