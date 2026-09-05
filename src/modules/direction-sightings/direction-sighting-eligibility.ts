import { Category } from '@shared/taxonomy/taxonomy'

/**
 * Category eligibility for direction sighting (decision 201): FIXED IN
 * CODE, never admin-editable — mirrors
 * modules/help-matching/dynamic-radius.ts's `STRATEGY_BY_CATEGORY`
 * hardcoded-table pattern (a plain in-code table, no DB, no cache, no
 * admin screen), NOT RiskTierConfig's DB+cache+admin pattern. This is why
 * DS3 (panel) stays empty (207) — there is nothing for an admin to edit.
 *
 * The set is exactly dynamic-radius.ts's "things that move" subset — the
 * categories STRATEGY_BY_CATEGORY marks with `growthKmPerHour > 0`:
 * robbery, kidnapping, fugitive, missing. A fleeing subject is precisely
 * what direction sighting exists to track; every other category (assault,
 * homicide, vandalism, etc.) "stays where witnesses are" per
 * dynamic-radius.ts's own comment, so a compass-direction sighting has no
 * meaning for it.
 */
export const DIRECTION_SIGHTING_ELIGIBLE_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'robbery',
  'kidnapping',
  'fugitive',
  'missing',
])

export function isDirectionSightingEligible(category: Category | null): boolean {
  return category !== null && DIRECTION_SIGHTING_ELIGIBLE_CATEGORIES.has(category)
}
