import * as repository from '@modules/help-matching/help-matching.repository'
import {
  FeedItem,
  FeedPage,
  FeedQuery,
  NearbyReportRow,
} from '@modules/help-matching/help-matching.interface'
import { getRiskTier, RiskTier } from '@shared/risk/risk-tier'
import {
  degradePosition,
  degradeTimestamp,
  DISTANCE_STEP_BY_TIER,
  haversineKm,
  snap,
} from '@shared/geo/degrade'
import { Direction } from '@shared/direction-sighting/direction-estimate'

const PAGE_SIZE = 20

function toFeedItem(
  row: NearbyReportRow,
  tier: RiskTier,
  viewer: { lat: number; lng: number },
  directionEstimate: { direction: Direction } | null
): FeedItem {
  const position = degradePosition(row, tier)
  // Distance derives from the DEGRADED position: a precise distance from
  // several viewpoints would triangulate the exact position right back.
  const distance = snap(haversineKm(viewer, position), DISTANCE_STEP_BY_TIER[tier])
  return {
    reportId: row.id,
    category: row.category,
    freeTag: row.freeTag,
    subject: row.subject,
    tier,
    position,
    distanceKm: distance,
    createdAt: degradeTimestamp(row.createdAt, tier),
    directionEstimate,
  }
}

/**
 * ListNearbyReports (spec task 05, decisions 2/7/21/135). Anonymous by
 * design — the viewer's position is used transiently for the query and
 * never stored (minimization, decision 110). Degradation itself lives in
 * @shared/geo/degrade, shared with the report detail view (R3): feed and
 * detail must degrade identically or the sharper one betrays the position.
 */
export async function listNearbyReports(query: FeedQuery): Promise<FeedPage> {
  const offset = (query.page - 1) * PAGE_SIZE
  const rows = await repository.listNearby(
    { lat: query.lat, lng: query.lng },
    query.order,
    offset,
    PAGE_SIZE + 1
  )

  const hasMore = rows.length > PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // One tier lookup per distinct category (TTL-cached in shared/risk).
  const tiers = new Map<string, RiskTier>()
  for (const row of pageRows) {
    const key = row.category ?? '__free_tag'
    if (!tiers.has(key)) {
      tiers.set(key, await getRiskTier(row.category))
    }
  }

  // DS1 (decisions 200-207): ONE batched query for the whole page — never
  // one per row (the same discipline the tier lookup above applies to
  // categories). An empty page skips the call entirely — no wasted
  // round-trip (mirrors insertRecipients' empty-array no-op elsewhere).
  const directionEstimates =
    pageRows.length === 0
      ? new Map<number, { direction: Direction } | null>()
      : await repository.findDirectionEstimates(pageRows.map((row) => row.id))

  return {
    items: pageRows.map((row) =>
      toFeedItem(
        row,
        tiers.get(row.category ?? '__free_tag') as RiskTier,
        { lat: query.lat, lng: query.lng },
        directionEstimates.get(row.id) ?? null
      )
    ),
    page: query.page,
    hasMore,
    order: query.order,
  }
}
