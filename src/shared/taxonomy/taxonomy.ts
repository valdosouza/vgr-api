/**
 * Two-axis taxonomy (decisions 3/9/140 — spec task 01 as amended by E2).
 * Both axes live in CODE in the MVP (decision 140d); an admin-managed
 * registry is a future evolution, same trajectory as risk-config.
 * Promoted to shared when help-matching became the second consumer
 * (amendment E8 pattern) — reports.interface re-exports.
 *
 * Canonical names in English (decision 17); the app translates labels.
 * Seed = spec list ∪ inherited icon set, freely curated (decision 140c —
 * the icons are reference, not contract).
 */
export const CATEGORIES = [
  'assault',
  'environmental',
  'robbery',
  'homicide',
  'illegal_commerce',
  // 'missing', not the spec's 'missing_person' (decision 140c freedom):
  // with the mandatory subject axis, "what disappeared" is the SUBJECT —
  // missing+child, missing+adult, missing+animal — and the icon set's
  // generic "desaparecido" is the honest category name.
  'missing',
  'fugitive',
  'kidnapping',
  'suspicious',
  'trafficking',
  'traffic',
  'vandalism',
] as const

export type Category = (typeof CATEGORIES)[number]

/**
 * Second axis — MANDATORY on every report (decision 140b, owner's call).
 * 'other' is the one-tap fallback that keeps the mandatory field from
 * ever delaying the seconds-critical submission (decision 123).
 * 'child' is what the decision-25 retention rule keys on.
 */
export const SUBJECTS = [
  'child',
  'adult',
  'animal',
  'vehicle',
  'property',
  'commerce',
  'weapon',
  'environment',
  'other',
] as const

export type Subject = (typeof SUBJECTS)[number]
