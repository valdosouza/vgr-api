import * as repository from '@modules/help-matching/help-matching.repository'
import {
  FeedItem,
  FeedPage,
  FeedQuery,
  NearbyReportRow,
} from '@modules/help-matching/help-matching.interface'
import { getRiskTier, RiskTier } from '@shared/risk/risk-tier'

const PAGE_SIZE = 20

/**
 * Degradation by tier (decision 135) — the EXACT position never leaves
 * the API. Grid rounding is deterministic on purpose: random jitter can
 * be averaged out by repeated reads; a fixed grid cannot.
 *   low    ~0.001° ≈ 110 m  (street)
 *   medium ~0.005° ≈ 550 m  (blocks)
 *   high   ~0.01°  ≈ 1.1 km (neighborhood)
 */
const GRID_BY_TIER: Record<RiskTier, number> = { low: 0.001, medium: 0.005, high: 0.01 }

/** Timestamp rounding (decision 41 — temporal correlation is a
 *  deanonymization vector): low=minute, medium=15 min, high=hour. */
const TIME_MS_BY_TIER: Record<RiskTier, number> = {
  low: 60_000,
  medium: 15 * 60_000,
  high: 60 * 60_000,
}

/** Distance served to the viewer, rounded per tier. */
const DISTANCE_STEP_BY_TIER: Record<RiskTier, number> = { low: 0.1, medium: 0.5, high: 1 }

function snap(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6))
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

function toFeedItem(row: NearbyReportRow, tier: RiskTier, viewer: { lat: number; lng: number }): FeedItem {
  const grid = GRID_BY_TIER[tier]
  const position = { lat: snap(row.lat, grid), lng: snap(row.lng, grid) }
  // Distance derives from the DEGRADED position: a precise distance from
  // several viewpoints would triangulate the exact position right back.
  const distance = snap(haversineKm(viewer, position), DISTANCE_STEP_BY_TIER[tier])
  const timeStep = TIME_MS_BY_TIER[tier]
  const createdAt = new Date(
    Math.floor(new Date(row.createdAt).getTime() / timeStep) * timeStep
  ).toISOString()
  return {
    reportId: row.id,
    category: row.category,
    freeTag: row.freeTag,
    subject: row.subject,
    tier,
    position,
    distanceKm: distance,
    createdAt,
  }
}

/**
 * ListNearbyReports (spec task 05, decisions 2/7/21/135). Anonymous by
 * design — the viewer's position is used transiently for the query and
 * never stored (minimization, decision 110).
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

  return {
    items: pageRows.map((row) =>
      toFeedItem(row, tiers.get(row.category ?? '__free_tag') as RiskTier, {
        lat: query.lat,
        lng: query.lng,
      })
    ),
    page: query.page,
    hasMore,
    order: query.order,
  }
}
