import {
  calculateDynamicRadius,
  MAX_RADIUS_KM,
  radiusStrategy,
} from '@modules/help-matching/dynamic-radius'

describe('dynamic-radius (decisions 7/29 — spec task 04)', () => {
  it('lost pet (missing×animal): larger over time, keeps growing, capped', () => {
    const fresh = calculateDynamicRadius('missing', 'animal', 0)
    const later = calculateDynamicRadius('missing', 'animal', 10)
    const week = calculateDynamicRadius('missing', 'animal', 24 * 7)

    expect(later).toBeGreaterThan(fresh)
    expect(week).toBeGreaterThan(later)
    expect(week).toBeLessThanOrEqual(80) // found far, but never unbounded
  })

  it('domestic/public violence (assault): small and FIXED', () => {
    expect(calculateDynamicRadius('assault', 'adult', 0)).toBe(2)
    expect(calculateDynamicRadius('assault', 'adult', 48)).toBe(2)
  })

  it('missing child escalates faster than missing adult (decision 140 subject axis)', () => {
    const child = calculateDynamicRadius('missing', 'child', 4)
    const adult = calculateDynamicRadius('missing', 'adult', 4)
    expect(child).toBeGreaterThan(adult)
  })

  it('stolen vehicle reach grows with elapsed time × speed (decision 7 table)', () => {
    expect(calculateDynamicRadius('robbery', 'vehicle', 1)).toBeGreaterThan(
      calculateDynamicRadius('robbery', 'vehicle', 0)
    )
  })

  it('free-tag reports use the moderate static default', () => {
    expect(calculateDynamicRadius(null, 'other', 0)).toBe(5)
    expect(calculateDynamicRadius(null, 'other', 100)).toBe(5)
  })

  it('never a fixed global radius (success criterion 8)', () => {
    expect(radiusStrategy('kidnapping', 'child')).not.toEqual(radiusStrategy('assault', 'adult'))
  })

  it('negative age never shrinks below base (clock skew safety)', () => {
    expect(calculateDynamicRadius('missing', 'animal', -5)).toBe(3)
  })

  it('MAX_RADIUS_KM covers every cap in the table (bounding-box guarantee)', () => {
    expect(MAX_RADIUS_KM).toBe(300)
  })
})
