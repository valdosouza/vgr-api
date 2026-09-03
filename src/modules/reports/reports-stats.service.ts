import * as repository from '@modules/reports/reports-stats.repository'
import { ReportStats, StatsRange } from '@modules/reports/reports.interface'
import { isDateOnly, ReportStatsQuery } from '@modules/reports/reports-admin.dto'
import { getRiskTier, RiskTier } from '@shared/risk/risk-tier'
import { floorCount } from '@shared/stats/k-anonymity'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'

/**
 * Statistics on the panel — B4 of plano-moderacao-painel.md (decisions
 * 164/165). What this file guarantees, and the tests prove:
 *
 *  - aggregates ONLY: nothing here carries a row id, a position or an
 *    identity (164/135/23) — the repository selects none, and the
 *    response shape has no field for them;
 *  - the k = 5 floor (164) is applied to EVERY count, in ONE place
 *    (`floorCount`), AFTER summing — byTier is summed from the raw
 *    byCategory counts and only then floored, so two "<5" categories in
 *    the same tier can still add up to a served tier count;
 *  - no geo aggregation of any kind in this phase (164);
 *  - the range follows the B1 date rules; `to` defaults to now, `from`
 *    to 30 days before, at most 366 days apart.
 *
 * The read is deliberately NOT audited (aggregates are not evidence —
 * unlike the case detail, 166).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_DAYS = 30
export const MAX_RANGE_DAYS = 366

const TIERS: RiskTier[] = ['low', 'medium', 'high']

function validationFailed(field: string, message: string, code: string, params?: Record<string, string>): HttpError {
  return new HttpError(
    422,
    'Validation failed',
    [{ field, message, code, ...(params ? { params } : {}) }],
    ErrorCodes.VALIDATION_FAILED
  )
}

/** `from` inclusive (date-only -> midnight UTC); `to` exclusive at the
 *  NEXT midnight when date-only, inclusive when a date-time was given
 *  or when it defaulted to `now`. */
export function resolveStatsRange(query: ReportStatsQuery, now: Date): StatsRange {
  // `toInput` is the instant the caller named (midnight for a date-only
  // value); `to` is the bound actually queried. The ordering check uses
  // the INPUT: from=09-02 / to=09-01 must fail even though 09-01's
  // exclusive bound (09-02 00:00) equals `from`.
  let toInput: Date
  let to: Date
  let toExclusive: boolean
  if (query.to === undefined) {
    toInput = now
    to = now
    toExclusive = false
  } else if (isDateOnly(query.to)) {
    toInput = new Date(`${query.to}T00:00:00.000Z`)
    to = new Date(toInput.getTime() + DAY_MS)
    toExclusive = true
  } else {
    toInput = new Date(query.to)
    to = toInput
    toExclusive = false
  }

  const from =
    query.from === undefined
      ? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS)
      : isDateOnly(query.from)
        ? new Date(`${query.from}T00:00:00.000Z`)
        : new Date(query.from)

  if (from.getTime() > toInput.getTime()) {
    throw validationFailed('from', 'from must not be after to', FieldErrorCodes.INVALID_VALUE)
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw validationFailed(
      'to',
      `Range must not exceed ${MAX_RANGE_DAYS} days`,
      FieldErrorCodes.TOO_LONG,
      { max: String(MAX_RANGE_DAYS) }
    )
  }
  return { from, to, toExclusive }
}

export async function getReportStats(query: ReportStatsQuery, now: Date = new Date()): Promise<ReportStats> {
  const range = resolveStatsRange(query, now)

  const [totals, byPeriod, byCategory, bySubject, byStatus, hiddenByReason, blockedMediaByReason] =
    await Promise.all([
      repository.countTotals(range),
      repository.countByPeriod(range, query.granularity),
      repository.countByCategory(range),
      repository.countBySubject(range),
      repository.countByStatus(range),
      repository.countHiddenByReason(range),
      repository.countBlockedMediaByReason(range),
    ])

  // Tier per category from shared/risk (46/135); free-tag rows sit at
  // getRiskTier(null). Summed RAW, floored afterwards (164).
  const rawByTier: Record<RiskTier, number> = { low: 0, medium: 0, high: 0 }
  const categories: ReportStats['byCategory'] = []
  for (const row of byCategory) {
    const tier = await getRiskTier(row.category)
    rawByTier[tier] += row.reports
    categories.push({ category: row.category, tier, reports: floorCount(row.reports) })
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), granularity: query.granularity },
    totals: {
      reports: floorCount(totals.reports),
      open: floorCount(totals.open),
      resolved: floorCount(totals.resolved),
      anonymous: floorCount(totals.anonymous),
      identified: floorCount(totals.identified),
      frozen: floorCount(totals.frozen),
      hidden: floorCount(totals.hidden),
      expired: floorCount(totals.expired),
      purged: floorCount(totals.purged),
      withMedia: floorCount(totals.withMedia),
    },
    byPeriod: byPeriod.map((row) => ({ period: row.period, reports: floorCount(row.reports) })),
    byCategory: categories,
    bySubject: bySubject.map((row) => ({ subject: row.subject, reports: floorCount(row.reports) })),
    byStatus: byStatus.map((row) => ({ status: row.status, reports: floorCount(row.reports) })),
    byTier: TIERS.map((tier) => ({ tier, reports: floorCount(rawByTier[tier]) })),
    moderation: {
      hiddenByReason: hiddenByReason.map((row) => ({
        reasonCode: row.reasonCode,
        reports: floorCount(row.reports),
      })),
      blockedMediaByReason: blockedMediaByReason.map((row) => ({
        reasonCode: row.reasonCode,
        media: floorCount(row.media),
      })),
    },
  }
}
