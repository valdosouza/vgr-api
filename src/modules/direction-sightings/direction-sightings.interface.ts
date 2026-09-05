/** Direction moved to @shared/direction-sighting/direction-estimate — the
 *  same "promoted when a second consumer appears" rule that moved
 *  Category/Subject to @shared/taxonomy/taxonomy (reports.interface.ts's
 *  own comment). Re-exported here to keep the module surface stable for
 *  its own dto/repository/service/controller files. */
export { DIRECTIONS } from '@shared/direction-sighting/direction-estimate'
export type { Direction } from '@shared/direction-sighting/direction-estimate'
import type { Direction } from '@shared/direction-sighting/direction-estimate'
import type { Category } from '@shared/taxonomy/taxonomy'

/** One row of the append-only log (tb_direction_sighting, migration 047). */
export interface DirectionSightingRow {
  id: number
  reportId: number
  direction: Direction
  /** The resolved 27/205 multiplier AT THE TIME OF LOGGING — never
   *  recomputed if the env var changes later. */
  weight: number
  accountId: number | null
  clientKey: string
  createdAt: Date
}

export interface LogDirectionSightingInput {
  reportId: number
  direction: Direction
  /** Replay-safety ONLY (28/137) — unlike tb_report/tb_panic_alert this
   *  never doubles as a bearer secret: a sighting is append-only, never
   *  resolved/edited later, so there is nothing to prove ownership of
   *  after the fact. */
  clientKey: string
}

/** Who is logging — mirrors help-offers' SubmitHelpOfferContext shape:
 *  identity is optional (decision 200: any viewer but the reporter). */
export interface DirectionSightingActor {
  accountId: number | null
  ip: string
}

/** The guard columns findReportForSighting needs — mirrors help-offers'
 *  findReportForOffer shape, plus `category` for the eligibility gate
 *  (201). SQL over tb_report lives in THIS module's own repository —
 *  table access, not a module import (help-offers.repository.ts's
 *  documented posture). */
export interface ReportForSightingRow {
  id: number
  reporterAccountId: number | null
  status: string
  category: Category | null
}

/**
 * Decision 22/203: the WRITE response is a deliberate asymmetry — it may
 * carry a bit more than any READ path ever does, because it is private
 * feedback to the actor who just acted, not a public signal. `estimate`
 * is the single winning Direction (never a distribution, 203) and is
 * NEVER gated by the disclosure floor (202 governs READ paths only);
 * `count` (total sightings so far, any direction) exists ONLY here, never
 * on a READ path.
 */
export interface LogDirectionSightingResult {
  sightingId: number
  reportId: number
  estimate: Direction | null
  count: number
  /** True when the clientKey had already been accepted (137) — the
   *  controller answers 200 instead of 201. */
  replayed: boolean
}

/** What a READ path (report detail, feed) is ever allowed to carry
 *  (decision 203): the single winning direction, nothing else — no
 *  count, no distribution, ever. `null` when the category is ineligible
 *  or the report never reached the floor (202). */
export interface DirectionEstimateFacet {
  direction: Direction
}
