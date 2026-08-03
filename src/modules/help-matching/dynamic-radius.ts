import { Category, Subject } from '@shared/taxonomy/taxonomy'

/**
 * Dynamic radius per case type (decisions 7/29 — spec task 04). Never a
 * fixed global value (success criterion 8): each report's reach is
 * base + growth × age, capped — a lost pet is found far and days later,
 * a stolen vehicle's reach grows with elapsed time × average speed, and
 * domestic violence stays in the neighborhood.
 *
 * This table is the SINGLE source: calculateDynamicRadius uses it in TS
 * and the feed repository compiles it into the SQL derived tables, so
 * the two can never drift.
 */
export interface RadiusStrategy {
  baseKm: number
  growthKmPerHour: number
  capKm: number
}

/** Free-tag reports (no category) — moderate, static. */
export const DEFAULT_STRATEGY: RadiusStrategy = { baseKm: 5, growthKmPerHour: 0, capKm: 5 }

export const STRATEGY_BY_CATEGORY: Record<Category, RadiusStrategy> = {
  // Violence stays where witnesses are (decision 7's table).
  assault: { baseKm: 2, growthKmPerHour: 0, capKm: 2 },
  homicide: { baseKm: 5, growthKmPerHour: 0, capKm: 5 },
  suspicious: { baseKm: 2, growthKmPerHour: 0, capKm: 2 },
  vandalism: { baseKm: 2, growthKmPerHour: 0, capKm: 2 },
  illegal_commerce: { baseKm: 3, growthKmPerHour: 0, capKm: 3 },
  trafficking: { baseKm: 5, growthKmPerHour: 0, capKm: 5 },
  traffic: { baseKm: 5, growthKmPerHour: 0, capKm: 5 },
  environmental: { baseKm: 10, growthKmPerHour: 0, capKm: 10 },
  // Things that MOVE: reach grows with elapsed time × plausible speed.
  robbery: { baseKm: 2, growthKmPerHour: 20, capKm: 120 },
  kidnapping: { baseKm: 10, growthKmPerHour: 40, capKm: 300 },
  fugitive: { baseKm: 10, growthKmPerHour: 5, capKm: 150 },
  missing: { baseKm: 5, growthKmPerHour: 3, capKm: 60 },
}

/** The subject axis refines movement (decision 140 made it mandatory):
 *  a lost pet roams far; a missing child escalates fastest of all. */
export const STRATEGY_BY_CATEGORY_SUBJECT: Partial<
  Record<Category, Partial<Record<Subject, RadiusStrategy>>>
> = {
  missing: {
    animal: { baseKm: 3, growthKmPerHour: 4, capKm: 80 },
    child: { baseKm: 2, growthKmPerHour: 6, capKm: 100 },
  },
}

/** Largest cap in the table — the feed's bounding box uses it. */
export const MAX_RADIUS_KM = Math.max(
  DEFAULT_STRATEGY.capKm,
  ...Object.values(STRATEGY_BY_CATEGORY).map((s) => s.capKm),
  ...Object.values(STRATEGY_BY_CATEGORY_SUBJECT).flatMap((bySubject) =>
    Object.values(bySubject ?? {}).map((s) => s.capKm)
  )
)

export function radiusStrategy(category: Category | null, subject: Subject): RadiusStrategy {
  if (category === null) return DEFAULT_STRATEGY
  return STRATEGY_BY_CATEGORY_SUBJECT[category]?.[subject] ?? STRATEGY_BY_CATEGORY[category]
}

export function calculateDynamicRadius(
  category: Category | null,
  subject: Subject,
  ageHours: number
): number {
  const strategy = radiusStrategy(category, subject)
  return Math.min(strategy.capKm, strategy.baseKm + strategy.growthKmPerHour * Math.max(0, ageHours))
}
