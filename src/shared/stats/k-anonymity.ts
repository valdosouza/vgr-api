/**
 * Aggregation floor (decision 164): any statistical cell with a count
 * below k = 5 is served as the literal "<5" so a rare combination of
 * period x category x subject x status x tier cannot re-identify a case
 * or a person — the logic of decision 41 applied to aggregates. Zero is
 * NOT floored: an empty cell names nobody.
 *
 * ONE function, ONE place. Every count that leaves the API goes through
 * it — totals, groupings and sums alike — AFTER any summing (byTier is
 * summed from the raw byCategory counts and only then floored).
 */
export const K_ANONYMITY_FLOOR = 5

export const BELOW_FLOOR = '<5' as const

export type StatCount = number | typeof BELOW_FLOOR

export function floorCount(count: number): StatCount {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`floorCount expects a non-negative integer, got ${count}`)
  }
  if (count === 0) return 0
  return count < K_ANONYMITY_FLOOR ? BELOW_FLOOR : count
}
