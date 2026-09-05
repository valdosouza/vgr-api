/**
 * Direction Sighting reconciliation (DS1 — decisions 22, 26, 200-207).
 * Promoted to shared — the same "second consumer promotes it" rule that
 * moved Category/Subject to shared/taxonomy/taxonomy.ts and
 * haversineKm/degradePosition to shared/geo/degrade.ts — because THREE
 * modules need the IDENTICAL algorithm: direction-sightings (writes and
 * owns the aggregate, and needs it for its own synchronous write
 * response), reports (report-detail facet) and help-matching (feed
 * facet). Pure and DB-free: every caller reads its own small
 * per-report accumulator rows (at most 8, one per compass point) via its
 * OWN SQL — table access, not a module import — and hands them here.
 */

/** 8-point compass, per the tactical spec (003-api-tactical-design.md). */
export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export type Direction = (typeof DIRECTIONS)[number]

/** One row of the materialized aggregate (tb_direction_estimate) — the
 *  accumulated weight and count for ONE direction of ONE report. */
export interface DirectionAccumulatorRow {
  direction: Direction
  /** Sum of every SightingWeight (27/205) contributed to this direction. */
  totalWeight: number
  /** How many sightings (of any weight) contributed — decision 202's
   *  floor sums this across every direction, never just the winner's. */
  sightingCount: number
  /** When this direction was FIRST reported for this report — the
   *  deterministic tie-break key below. */
  firstReportedAt: Date
}

/**
 * Decision 26: weighted reconciliation, never a simple majority vote —
 * the direction with the highest ACCUMULATED WEIGHT wins, regardless of
 * which direction has more raw sightings. A tie (equal weight) is broken
 * by whichever direction was reported FIRST for this report: deterministic
 * and documented, rather than left to insertion order or a random pick.
 */
export function pickWinningDirection(rows: DirectionAccumulatorRow[]): Direction | null {
  if (rows.length === 0) return null
  return rows.reduce((best, row) => {
    if (row.totalWeight > best.totalWeight) return row
    if (row.totalWeight === best.totalWeight && row.firstReportedAt < best.firstReportedAt) return row
    return best
  }).direction
}

/** Decision 202: the floor counts sightings across EVERY direction, not
 *  the winner's own count — anti-contravigilância, not a confidence
 *  threshold on the winning direction specifically. */
export function totalSightingCount(rows: DirectionAccumulatorRow[]): number {
  return rows.reduce((sum, row) => sum + row.sightingCount, 0)
}

/** Decision 202: env-configurable floor gate (see
 *  shared/config/env.ts's directionSightingConfig — DIRECTION_SIGHTING_MIN_COUNT,
 *  default 5). Governs READ paths only — the actor's own synchronous
 *  write response (decision 22) is never gated by this. */
export function meetsDisclosureFloor(rows: DirectionAccumulatorRow[], minCount: number): boolean {
  return totalSightingCount(rows) >= minCount
}
