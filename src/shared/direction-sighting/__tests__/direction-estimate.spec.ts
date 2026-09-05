import {
  DIRECTIONS,
  meetsDisclosureFloor,
  pickWinningDirection,
  totalSightingCount,
} from '@shared/direction-sighting/direction-estimate'

/**
 * Pure reconciliation logic (decision 26): weighted, never a simple
 * majority vote. Promoted to shared — like @shared/geo/degrade.ts's
 * haversineKm/degradePosition — because THREE modules need the identical
 * algorithm: direction-sightings (writes/owns the aggregate), reports
 * (report-detail facet) and help-matching (feed facet).
 */
describe('direction-estimate reconciliation (decision 26)', () => {
  it('exposes exactly the 8-point compass', () => {
    expect(DIRECTIONS).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])
  })

  describe('pickWinningDirection', () => {
    it('returns null for an empty accumulator set', () => {
      expect(pickWinningDirection([])).toBeNull()
    })

    it('picks the single direction when only one exists', () => {
      const rows = [
        { direction: 'N' as const, totalWeight: 0.5, sightingCount: 1, firstReportedAt: new Date('2026-09-01') },
      ]
      expect(pickWinningDirection(rows)).toBe('N')
    })

    it('picks the direction with the HIGHEST accumulated weight, not the highest count', () => {
      // 3 anonymous sightings (weight 0.5 each = 1.5 total) for N vs 2
      // identified sightings (weight 1.0 each = 2.0 total) for S — fewer
      // sightings, more weight, must still win (decision 26/27).
      const rows = [
        { direction: 'N' as const, totalWeight: 1.5, sightingCount: 3, firstReportedAt: new Date('2026-09-01T10:00:00Z') },
        { direction: 'S' as const, totalWeight: 2.0, sightingCount: 2, firstReportedAt: new Date('2026-09-01T11:00:00Z') },
      ]
      expect(pickWinningDirection(rows)).toBe('S')
    })

    it('breaks a weight TIE by the earliest-reported direction (deterministic, documented)', () => {
      const rows = [
        { direction: 'E' as const, totalWeight: 1.0, sightingCount: 1, firstReportedAt: new Date('2026-09-01T12:00:00Z') },
        { direction: 'W' as const, totalWeight: 1.0, sightingCount: 1, firstReportedAt: new Date('2026-09-01T09:00:00Z') },
      ]
      expect(pickWinningDirection(rows)).toBe('W')
    })

    it('never picks by insertion order alone when weights differ', () => {
      const rows = [
        { direction: 'NE' as const, totalWeight: 3, sightingCount: 6, firstReportedAt: new Date('2026-09-01') },
        { direction: 'SW' as const, totalWeight: 0.5, sightingCount: 1, firstReportedAt: new Date('2026-08-01') },
      ]
      expect(pickWinningDirection(rows)).toBe('NE')
    })
  })

  describe('totalSightingCount / meetsDisclosureFloor (decision 202)', () => {
    it('sums counts across EVERY direction, not just the winner', () => {
      const rows = [
        { direction: 'N' as const, totalWeight: 1, sightingCount: 2, firstReportedAt: new Date() },
        { direction: 'S' as const, totalWeight: 1, sightingCount: 2, firstReportedAt: new Date() },
      ]
      expect(totalSightingCount(rows)).toBe(4)
    })

    it('is below the floor when the total is under the configured minimum', () => {
      const rows = [{ direction: 'N' as const, totalWeight: 5, sightingCount: 4, firstReportedAt: new Date() }]
      expect(meetsDisclosureFloor(rows, 5)).toBe(false)
    })

    it('meets the floor once the total reaches the configured minimum, regardless of how lopsided the weights are', () => {
      const rows = [
        { direction: 'N' as const, totalWeight: 100, sightingCount: 4, firstReportedAt: new Date() },
        { direction: 'S' as const, totalWeight: 0.5, sightingCount: 1, firstReportedAt: new Date() },
      ]
      expect(meetsDisclosureFloor(rows, 5)).toBe(true)
    })

    it('an empty accumulator set never meets a positive floor', () => {
      expect(meetsDisclosureFloor([], 5)).toBe(false)
    })
  })
})
