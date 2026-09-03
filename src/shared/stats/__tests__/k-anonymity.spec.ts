import { BELOW_FLOOR, floorCount, K_ANONYMITY_FLOOR } from '@shared/stats/k-anonymity'

/** Decision 164: every aggregate cell below k = 5 is served as "<5" so a
 *  rare combination cannot re-identify anyone; 0 is not a person. */
describe('shared/stats/k-anonymity — floorCount (decision 164)', () => {
  it('the floor is k = 5 and the marker is the literal "<5"', () => {
    expect(K_ANONYMITY_FLOOR).toBe(5)
    expect(BELOW_FLOOR).toBe('<5')
  })

  it('0 stays 0 — an empty cell reveals nothing', () => {
    expect(floorCount(0)).toBe(0)
  })

  it.each([1, 2, 3, 4])('%d is served as "<5"', (count) => {
    expect(floorCount(count)).toBe('<5')
  })

  it.each([5, 6, 100])('%d is served as the number', (count) => {
    expect(floorCount(count)).toBe(count)
  })

  it('a negative or non-finite input is a programming error', () => {
    expect(() => floorCount(-1)).toThrow()
    expect(() => floorCount(Number.NaN)).toThrow()
  })
})
