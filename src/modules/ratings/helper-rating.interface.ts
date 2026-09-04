/**
 * Helper rating — the HelperRating aggregate of Identity & Trust (spec
 * task 26, amended 2026-09-03 to live in modules/ratings; decisions 48,
 * 178-189). The reporter rates a helper's OFFER once the case is resolved
 * (181); the score accumulates on the helper's internal account (48/180)
 * and never reaches anyone but that helper, as an aggregate (184/185).
 */

/** The slice of tb_report the rating needs — read by SQL in this
 *  module's repository (table access, not a module import). */
export interface RatingReportRow {
  id: number
  /** The anonymous reporter's bearer secret (134/137). Internal only —
   *  never serialized. */
  clientKey: string
  reporterAccountId: number | null
  status: 'open' | 'resolved'
  /** Moderation (162): closes writes; excludes the rating from the
   *  aggregate while set (187). */
  hidden: boolean
  purged: boolean
}

/** The offer being rated, matched by id AND report — a foreign offer id
 *  is a 404, never a hint. helperAccountId null = no internal identity to
 *  accumulate on (180). */
export interface RatingOfferRow {
  id: number
  reportId: number
  helperAccountId: number | null
  anonymous: boolean
}

export interface HelperRatingRow {
  id: number
  helpOfferId: number
  reportId: number
  helperAccountId: number
  /** RatingScore of the spec: an integer 1..5, no text (182). */
  score: number
  /** App-generated idempotency key of THIS rating (137/183). */
  clientKey: string
  createdAt: Date
}

/** Who is rating — the reports' ViewerContext (account and/or the
 *  report's clientKey from the x-client-key header) plus the IP for the
 *  gate and the accountability trail (23). */
export interface RatingActor {
  accountId: number | null
  clientKey: string | null
  ip: string
}

export interface RateHelperInput {
  score: number
  clientKey: string
}

/** RateHelper output — the HelperRated event payload of the spec minus
 *  helperInternalId, which never leaves the API (48/60). */
export interface RateHelperResult {
  ratingId: number
  reportId: number
  helpOfferId: number
  score: number
  createdAt: string
  /** True when the clientKey had already been accepted (137) — the
   *  controller answers 200 instead of 201. */
  replayed: boolean
}

/** Raw aggregate as the repository counts it — ratings of currently
 *  hidden cases already excluded by the JOIN (187). */
export interface HelperRatingAggregateRow {
  count: number
  average: number | null
}

/** What a helper sees of themself (184): the count, and the average only
 *  at or above the k = 5 floor. Never per case. */
export interface HelperReputation {
  count: number
  average: number | null
}
