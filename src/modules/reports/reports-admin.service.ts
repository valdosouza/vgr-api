import * as repository from '@modules/reports/reports.repository'
import {
  PanelActorRef,
  ReportExactPosition,
  ReportListItem,
  ReportPage,
  ReportPanelDetail,
  ReportRow,
  ReportSearchFilters,
} from '@modules/reports/reports.interface'
import { isDateOnly, ReportSearchQuery } from '@modules/reports/reports-admin.dto'
import { CATEGORIES } from '@shared/taxonomy/taxonomy'
import { getRiskTier, RiskTier } from '@shared/risk/risk-tier'
import { degradePosition, GRID_BY_TIER } from '@shared/geo/degrade'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

/**
 * Panel plane of the report (B1 of plano-moderacao-painel.md, decisions
 * 159/160/166). What this file guarantees, and the tests prove:
 *
 *  - the EXACT position never leaves except via getReportExactPosition
 *    (159/135) — list and detail serve the same grid as the feed;
 *  - an anonymous report carries NO identity (160): never the internal
 *    reporter_account_id (23), never the clientKey, never an e-mail; an
 *    identified one only { accountId, displayName };
 *  - helpers in offers follow the same rule; the panel is the platform
 *    (60), so identified actors are not tier-degraded here and
 *    timestamps are exact (41 protects against the REPORTER's
 *    correlation, not the platform's).
 *
 * Audit rows (166) are written by the controller — the actor and IP
 * live at the HTTP layer (implementation note on decision 116).
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Metres per degree of latitude, rounded — the precision the grid
 *  (GRID_BY_TIER, 135) actually gives: ~110 / 550 / 1100 m. */
function precisionMeters(tier: RiskTier): number {
  return Math.round(GRID_BY_TIER[tier] * 110_000)
}

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)

/** Tier -> the categories currently in it (shared/risk is the authority,
 *  46/135); free-tag reports sit at getRiskTier(null). */
async function resolveTier(tier: RiskTier): Promise<Pick<ReportSearchFilters, 'categories' | 'includeFreeTag'>> {
  const categories: string[] = []
  for (const category of CATEGORIES) {
    if ((await getRiskTier(category)) === tier) categories.push(category)
  }
  return { categories, includeFreeTag: (await getRiskTier(null)) === tier }
}

/** `from` inclusive; `to` exclusive at the NEXT midnight when date-only,
 *  inclusive when a full date-time was given. */
function dateBounds(query: ReportSearchQuery): Pick<ReportSearchFilters, 'createdFrom' | 'createdTo' | 'createdToExclusive'> {
  const bounds: Pick<ReportSearchFilters, 'createdFrom' | 'createdTo' | 'createdToExclusive'> = {}
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

export async function searchReports(query: ReportSearchQuery): Promise<ReportPage> {
  const filters: ReportSearchFilters = {
    id: query.id,
    status: query.status,
    category: query.category,
    subject: query.subject,
    frozen: query.frozen,
    hasMedia: query.hasMedia,
    ...(query.tier === undefined ? {} : await resolveTier(query.tier)),
    ...dateBounds(query),
  }

  const { rows, total } = await repository.searchReports(filters, query.page, query.pageSize)
  const items: ReportListItem[] = []
  for (const row of rows) {
    const tier = await getRiskTier(row.category)
    items.push({
      reportId: row.id,
      category: row.category,
      freeTag: row.freeTag,
      subject: row.subject,
      tier,
      status: row.status,
      anonymous: row.anonymous,
      frozen: row.frozen,
      purged: row.purged,
      mediaCount: row.mediaCount,
      // The same grid as the feed (135) — or the sharper surface betrays
      // the position; purged rows have no position at all (25/131).
      position:
        row.purged || row.lat === null || row.lng === null
          ? null
          : degradePosition({ lat: row.lat, lng: row.lng }, tier),
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    })
  }
  return { items, page: query.page, pageSize: query.pageSize, total }
}

/** Decision 160: identified -> opaque id + display name; anonymous ->
 *  nothing, and the account is not even looked up. */
async function reporterOf(report: ReportRow): Promise<PanelActorRef | null> {
  if (report.anonymous || report.reporterAccountId === null) return null
  const displayName = await repository.findAccountDisplayName(report.reporterAccountId)
  return { accountId: report.reporterAccountId, displayName: displayName ?? '' }
}

export async function getReportPanelDetail(reportId: number): Promise<ReportPanelDetail> {
  const report = await repository.findById(reportId)
  if (!report) throw notFound()
  const tier = await getRiskTier(report.category)

  const skeleton: ReportPanelDetail = {
    reportId: report.id,
    category: report.category,
    freeTag: report.freeTag,
    subject: report.subject,
    tier,
    status: report.status,
    anonymous: report.anonymous,
    frozen: report.frozen,
    frozenReason: report.frozenReason,
    frozenAt: report.frozenAt ? report.frozenAt.toISOString() : null,
    purged: report.purged,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    expiresAt: report.expiresAt ? report.expiresAt.toISOString() : null,
    reporter: null,
    position: null,
    detailFields: null,
    timeline: [],
    media: [],
    offers: [],
  }
  // Purged (25/131): the statistical skeleton is all that is left — and
  // all the panel gets; nothing else is even queried.
  if (report.purged) return skeleton

  const [timeline, media, offers, reporter] = await Promise.all([
    repository.getTimeline(report.id),
    repository.findAttachedMediaWithStatus(report.id),
    repository.findOffersForPanel(report.id),
    reporterOf(report),
  ])

  return {
    ...skeleton,
    reporter,
    position:
      report.lat === null || report.lng === null
        ? null
        : { ...degradePosition({ lat: report.lat, lng: report.lng }, tier), precisionMeters: precisionMeters(tier) },
    detailFields: report.detailFields,
    timeline: timeline.map((event) => ({
      eventType: event.eventType,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
    media,
    offers: offers.map((offer) => ({
      helpOfferId: offer.id,
      helpType: offer.helpType,
      anonymous: offer.anonymous,
      helper:
        offer.anonymous || offer.helperAccountId === null
          ? null
          : { accountId: offer.helperAccountId, displayName: offer.helperDisplayName ?? '' },
      createdAt: offer.createdAt.toISOString(),
    })),
  }
}

/** The ONE exit for the exact position (159/135) — behind the stacked
 *  report_exact_position grant and audited by the controller. */
export async function getReportExactPosition(reportId: number): Promise<ReportExactPosition> {
  const report = await repository.findById(reportId)
  if (!report || report.purged || report.lat === null || report.lng === null) throw notFound()
  return { reportId: report.id, lat: report.lat, lng: report.lng }
}
