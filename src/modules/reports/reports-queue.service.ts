import * as repository from '@modules/reports/reports.repository'
import { QueueItem, QueuePage, QueueTierSets, ReportPanelDetail } from '@modules/reports/reports.interface'
import { getReportPanelDetail, toReportListItem } from '@modules/reports/reports-admin.service'
import { ReportQueueQuery } from '@modules/reports/reports-admin.dto'
import { CATEGORIES } from '@shared/taxonomy/taxonomy'
import { getRiskTier } from '@shared/risk/risk-tier'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

/**
 * Proactive moderation queue — B3 of plano-moderacao-painel.md (decisions
 * 161/165/166). What this file guarantees, and the tests prove:
 *
 *  - the queue is PROACTIVE (161): there is no user "flag" signal yet, so
 *    the queue is every open case not yet reviewed, not hidden (already
 *    moderated), not purged. Frozen cases STAY in it. The WHERE and the
 *    ORDER BY are the repository's SQL contract; this service only
 *    resolves the tier -> category sets (shared/risk is the authority,
 *    46/135 — same resolution B1 does for its tier filter) and maps rows;
 *  - every item is the B1 ReportListItem (degraded position, no identity
 *    — 135/160) plus `priority`, `hasMedia`, `ageHours`;
 *  - reviewing is ONE human with `reports` UPDATE (165) stamping
 *    reviewed_at / reviewed_by; no reason (it is not a moderation act),
 *    idempotent-hostile (second mark -> 409 DUPLICATE), never touching
 *    hidden / frozen / retention. The audit row (116) is the controller's.
 *    Un-review is not part of B3.
 *
 * Queue reads are list reads and are NOT audited (166); opening a case
 * from the queue goes through the B1 detail, which is.
 */

const HOUR_MS = 60 * 60 * 1000

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
const alreadyReviewed = () =>
  new HttpError(409, 'Report is already reviewed', undefined, ErrorCodes.DUPLICATE)

/** Every category into the tier it currently sits in; free-tag rows rank
 *  by getRiskTier(null). Exported for the tests' inputs, not for reuse. */
export async function resolveQueueTiers(): Promise<QueueTierSets> {
  const tierCategories: QueueTierSets['tierCategories'] = { high: [], medium: [], low: [] }
  for (const category of CATEGORIES) {
    tierCategories[await getRiskTier(category)].push(category)
  }
  return { tierCategories, freeTagTier: await getRiskTier(null) }
}

/** Whole hours since created_at against the injected clock; clock skew
 *  (a row "from the future") reads as 0, never negative. */
function ageHoursOf(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / HOUR_MS))
}

export async function getModerationQueue(
  query: ReportQueueQuery,
  now: Date = new Date()
): Promise<QueuePage> {
  const tiers = await resolveQueueTiers()
  const { rows, total } = await repository.queueReports(tiers, query.page, query.pageSize)

  const items: QueueItem[] = []
  for (const row of rows) {
    const tier = await getRiskTier(row.category)
    items.push({
      ...toReportListItem(row, tier),
      // Priority IS the tier today; when the user "flag" signal exists
      // (161) it will rank above the tier — in the repository's ORDER BY.
      priority: tier,
      hasMedia: row.mediaCount > 0,
      ageHours: ageHoursOf(row.createdAt, now),
    })
  }
  return { items, page: query.page, pageSize: query.pageSize, total }
}

/** Missing, soft-deleted and purged all answer 404 (a purged skeleton
 *  has nothing left to review, 25/131); already reviewed answers 409. */
export async function markReviewed(reportId: number, actorId: number): Promise<ReportPanelDetail> {
  const report = await repository.findById(reportId)
  if (!report || report.purged) throw notFound()
  if (report.reviewedAt !== null) throw alreadyReviewed()
  // The atomic WHERE reviewed_at IS NULL makes a concurrent mark lose cleanly.
  const transitioned = await repository.markReviewed(reportId, actorId)
  if (!transitioned) throw alreadyReviewed()
  return getReportPanelDetail(reportId)
}
