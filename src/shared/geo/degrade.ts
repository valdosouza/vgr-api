import { RiskTier } from '@shared/risk/risk-tier'

/**
 * Tier degradation for anything public-facing (decisions 41/135).
 * Promoted from help-matching when the report detail view became the
 * second consumer (R3) — feed and detail MUST degrade identically, or
 * the sharper one betrays the position.
 *
 * The EXACT position never leaves the API. Grid rounding is deterministic
 * on purpose: random jitter can be averaged out by repeated reads; a
 * fixed grid cannot.
 *   low    ~0.001° ≈ 110 m  (street)
 *   medium ~0.005° ≈ 550 m  (blocks)
 *   high   ~0.01°  ≈ 1.1 km (neighborhood)
 */
export const GRID_BY_TIER: Record<RiskTier, number> = { low: 0.001, medium: 0.005, high: 0.01 }

/** Timestamp rounding (decision 41 — temporal correlation deanonymizes):
 *  low=minute, medium=15 min, high=hour. */
export const TIME_MS_BY_TIER: Record<RiskTier, number> = {
  low: 60_000,
  medium: 15 * 60_000,
  high: 60 * 60_000,
}

/** Distance served to a viewer, rounded per tier. */
export const DISTANCE_STEP_BY_TIER: Record<RiskTier, number> = { low: 0.1, medium: 0.5, high: 1 }

export function snap(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(6))
}

export function degradePosition(
  position: { lat: number; lng: number },
  tier: RiskTier
): { lat: number; lng: number } {
  const grid = GRID_BY_TIER[tier]
  return { lat: snap(position.lat, grid), lng: snap(position.lng, grid) }
}

export function degradeTimestamp(date: Date, tier: RiskTier): string {
  const step = TIME_MS_BY_TIER[tier]
  return new Date(Math.floor(new Date(date).getTime() / step) * step).toISOString()
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}
