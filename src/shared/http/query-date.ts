import { z } from 'zod'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/**
 * Date filter rule shared by the panel list endpoints — born in
 * reports-admin.dto (B1, decision 166) and promoted here when B5's
 * admin-audit module needed the SAME semantics without one module
 * importing another (ARCHITECTURE.md: shared dependencies go to shared/).
 *
 * A query param is a string: it must be ISO date-time or `YYYY-MM-DD`
 * (INVALID_FORMAT otherwise, decision 83). Semantics on `created_at`:
 * `from` inclusive; a date-only `to` covers the WHOLE day (bound is the
 * next midnight UTC, compared with `<`); a date-time `to` is inclusive.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

export const queryDate = z.string().refine(
  (value) => DATE_ONLY.test(value) || !Number.isNaN(Date.parse(value)),
  { message: 'Expected ISO date-time or YYYY-MM-DD', params: { code: FieldErrorCodes.INVALID_FORMAT } }
)

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value)
}

export interface DateBounds {
  createdFrom?: Date
  createdTo?: Date
  /** true when `to` was date-only (next-midnight bound, `<`). */
  createdToExclusive?: boolean
}

/** Turns validated `from`/`to` strings into the repository bounds. */
export function toDateBounds(query: { from?: string; to?: string }): DateBounds {
  const bounds: DateBounds = {}
  if (query.from !== undefined) {
    bounds.createdFrom = isDateOnly(query.from) ? new Date(`${query.from}T00:00:00.000Z`) : new Date(query.from)
  }
  if (query.to !== undefined) {
    if (isDateOnly(query.to)) {
      bounds.createdTo = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + DAY_MS)
      bounds.createdToExclusive = true
    } else {
      bounds.createdTo = new Date(query.to)
      bounds.createdToExclusive = false
    }
  }
  return bounds
}
