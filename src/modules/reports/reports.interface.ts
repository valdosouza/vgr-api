/**
 * Two-axis taxonomy (decisions 3/9/140 — spec task 01 as amended by E2).
 * Both axes live in CODE in the MVP (decision 140d); an admin-managed
 * registry is a future evolution, same trajectory as risk-config.
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
  'missing_person',
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

export type ReportStatus = 'open' | 'resolved'

export interface ReportRow {
  id: number
  clientKey: string
  category: Category | null
  freeTag: string | null
  subject: Subject
  detailFields: Record<string, unknown> | null
  lat: number
  lng: number
  anonymous: boolean
  reporterAccountId: number | null
  status: ReportStatus
  resolvedAt: Date | null
  expiresAt: Date | null
  frozen: boolean
  createdAt: Date
}

export interface SubmitReportInput {
  clientKey: string
  category: Category | null
  freeTag: string | null
  subject: Subject
  detailFields: Record<string, unknown> | null
  lat: number
  lng: number
  /** Explicit anonymity choice (decision 32). Forced true when there is
   *  no authenticated account. */
  anonymous: boolean
}

export interface SubmitReportContext {
  /** From optionalAppAuth — null on anonymous requests. */
  accountId: number | null
  ip: string
}

export interface SubmitReportResult {
  reportId: number
  status: ReportStatus
  /** True when the clientKey had already been accepted (decision 137) —
   *  the controller answers 200 instead of 201. */
  replayed: boolean
}
