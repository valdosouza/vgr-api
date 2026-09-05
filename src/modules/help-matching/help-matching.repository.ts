import pool from '@shared/db/connection'
import { Category } from '@shared/taxonomy/taxonomy'
import { FeedOrder, NearbyReportRow } from '@modules/help-matching/help-matching.interface'
import {
  DEFAULT_STRATEGY,
  MAX_RADIUS_KM,
  STRATEGY_BY_CATEGORY,
  STRATEGY_BY_CATEGORY_SUBJECT,
} from '@modules/help-matching/dynamic-radius'
import {
  Direction,
  meetsDisclosureFloor,
  pickWinningDirection,
} from '@shared/direction-sighting/direction-estimate'
import { directionSightingConfig } from '@shared/config/env'

/**
 * The feed query (spec task 05). SQL over tb_report is deliberate — the
 * repository belongs to help-matching (spec section 5), and the no-import
 * rule is about code, not tables.
 *
 * The radius strategy is compiled from the SAME TS table the domain
 * service uses (dynamic-radius.ts) into two derived tables, so the SQL
 * filter and calculateDynamicRadius can never drift. Values are
 * compile-time constants guarded by assertFinite — nothing user-supplied
 * is ever interpolated.
 */
function assertFinite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Radius strategy value must be finite')
  return value
}

function strategyRow(category: string | null, s: { baseKm: number; growthKmPerHour: number; capKm: number }): string {
  const cat = category === null ? 'NULL' : `'${category}'`
  return `SELECT ${cat} AS category, ${assertFinite(s.baseKm)} AS base_km, ${assertFinite(s.growthKmPerHour)} AS growth_kmh, ${assertFinite(s.capKm)} AS cap_km`
}

const CATEGORY_STRATEGY_SQL = [
  ...Object.entries(STRATEGY_BY_CATEGORY).map(([category, s]) => strategyRow(category, s)),
  strategyRow(null, DEFAULT_STRATEGY), // free-tag reports (category NULL)
].join(' UNION ALL ')

const SUBJECT_STRATEGY_SQL = Object.entries(STRATEGY_BY_CATEGORY_SUBJECT)
  .flatMap(([category, bySubject]) =>
    Object.entries(bySubject ?? {}).map(
      ([subject, s]) =>
        `SELECT '${category}' AS category, '${subject}' AS subject, ${assertFinite(s.baseKm)} AS base_km, ${assertFinite(s.growthKmPerHour)} AS growth_kmh, ${assertFinite(s.capKm)} AS cap_km`
    )
  )
  .join(' UNION ALL ')

const ORDER_SQL: Record<FeedOrder, string> = {
  recency: 'r.created_at DESC',
  // Near and fresh beats far and stale: normalized distance weighs 60%,
  // age (capped at 24h) 40%. Deterministic, documented (decision 21).
  relevance: '((distanceKm / radiusKm) * 0.6 + (LEAST(ageHours, 24) / 24) * 0.4) ASC',
}

export async function listNearby(
  viewer: { lat: number; lng: number },
  order: FeedOrder,
  offset: number,
  limit: number
): Promise<NearbyReportRow[]> {
  // Bounding box for the index; the exact filter is distance <= radius.
  const latDelta = MAX_RADIUS_KM / 111
  const lngDelta = MAX_RADIUS_KM / (111 * Math.max(0.2, Math.cos((viewer.lat * Math.PI) / 180)))

  const [rows] = await pool.query<any[]>(
    `SELECT r.id, r.category, r.free_tag AS freeTag, r.subject, r.lat, r.lng,
            r.created_at AS createdAt,
            ST_Distance_Sphere(POINT(r.lng, r.lat), POINT(?, ?)) / 1000 AS distanceKm,
            TIMESTAMPDIFF(MINUTE, r.created_at, NOW()) / 60 AS ageHours,
            LEAST(
              COALESCE(ss.cap_km, sc.cap_km),
              COALESCE(ss.base_km, sc.base_km)
                + COALESCE(ss.growth_kmh, sc.growth_kmh)
                  * (TIMESTAMPDIFF(MINUTE, r.created_at, NOW()) / 60)
            ) AS radiusKm
     FROM tb_report r
     JOIN (${CATEGORY_STRATEGY_SQL}) sc ON sc.category <=> r.category
     LEFT JOIN (${SUBJECT_STRATEGY_SQL}) ss
       ON ss.category = r.category AND ss.subject = r.subject
     WHERE r.deleted = 'N' AND r.status = 'open' AND r.hidden = 'N'
       AND r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
     HAVING distanceKm <= radiusKm
     ORDER BY ${ORDER_SQL[order]}
     LIMIT ? OFFSET ?`,
    [
      viewer.lng,
      viewer.lat,
      viewer.lat - latDelta,
      viewer.lat + latDelta,
      viewer.lng - lngDelta,
      viewer.lng + lngDelta,
      limit,
      offset,
    ]
  )

  return rows.map((row) => ({
    id: row.id,
    category: (row.category as Category) ?? null,
    freeTag: row.freeTag ?? null,
    subject: row.subject,
    lat: Number(row.lat),
    lng: Number(row.lng),
    createdAt: row.createdAt,
    distanceKm: Number(row.distanceKm),
    radiusKm: Number(row.radiusKm),
  }))
}

/**
 * DS1's feed facet (decisions 200-207, 204's "even the anonymous public
 * feed"): ONE batched query for the whole page — never one per row, the
 * same discipline listNearbyReports already applies to risk-tier lookups
 * (help-matching.service.ts's `tiers` Map). SQL over tb_direction_estimate
 * (owned by direction-sightings) is table access, not a module import —
 * same posture as listNearby's own tb_report query above. Returns a Map
 * keyed by reportId; a report absent from the map never had any
 * sightings, and one present but below the floor maps to `null` — the
 * caller (help-matching.service.ts) defaults a missing key to null too.
 */
export async function findDirectionEstimates(
  reportIds: number[]
): Promise<Map<number, { direction: Direction } | null>> {
  const result = new Map<number, { direction: Direction } | null>()
  if (reportIds.length === 0) return result

  const placeholders = reportIds.map(() => '?').join(', ')
  const [rows] = await pool.query<any[]>(
    `SELECT tb_report_id AS reportId, direction, total_weight AS totalWeight,
            sighting_count AS sightingCount, first_reported_at AS firstReportedAt
     FROM tb_direction_estimate
     WHERE tb_report_id IN (${placeholders})`,
    reportIds
  )

  const byReport = new Map<number, Array<{ direction: Direction; totalWeight: number; sightingCount: number; firstReportedAt: Date }>>()
  for (const row of rows) {
    const accumulators = byReport.get(row.reportId) ?? []
    accumulators.push({
      direction: row.direction as Direction,
      totalWeight: Number(row.totalWeight),
      sightingCount: row.sightingCount,
      firstReportedAt: row.firstReportedAt,
    })
    byReport.set(row.reportId, accumulators)
  }

  const minCount = directionSightingConfig().minCount
  for (const [reportId, accumulators] of byReport) {
    if (!meetsDisclosureFloor(accumulators, minCount)) {
      result.set(reportId, null)
      continue
    }
    const direction = pickWinningDirection(accumulators)
    result.set(reportId, direction ? { direction } : null)
  }

  return result
}
