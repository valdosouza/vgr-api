import * as repository from '@modules/direction-sightings/direction-sightings.repository'
import { isDirectionSightingEligible } from '@modules/direction-sightings/direction-sighting-eligibility'
import {
  DirectionSightingActor,
  DirectionSightingRow,
  LogDirectionSightingInput,
  LogDirectionSightingResult,
} from '@modules/direction-sightings/direction-sightings.interface'
import { Direction, pickWinningDirection, totalSightingCount } from '@shared/direction-sighting/direction-estimate'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { directionSightingConfig } from '@shared/config/env'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import { Capabilities } from '@shared/legal/capabilities'
import { assertCapability } from '@shared/legal/legal-gate'
import logger from '@shared/logger/logger'

/**
 * LogDirectionSighting — the DirectionSighting/DirectionEstimate
 * aggregate of DS1 (plano-direction-sightings.md, decisions 200-207,
 * closing the original 22/26/27/28). A community member near an OPEN
 * report whose category involves a fleeing subject taps one of 8 compass
 * directions; the API reconciles every sighting for that report into a
 * single weighted estimate SYNCHRONOUSLY (22), in the same request.
 */

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)

/** Reads the current per-direction accumulators and folds them into the
 *  {estimate, count} pair the write response always carries — NEVER
 *  gated by the disclosure floor (202 governs READ paths, not the
 *  actor's own synchronous feedback, decision 22). */
async function currentEstimate(reportId: number): Promise<{ estimate: Direction | null; count: number }> {
  const rows = await repository.findEstimateRows(reportId)
  return { estimate: pickWinningDirection(rows), count: totalSightingCount(rows) }
}

function toResult(
  sighting: { id: number; reportId: number },
  estimate: { estimate: Direction | null; count: number },
  replayed: boolean
): LogDirectionSightingResult {
  return {
    sightingId: sighting.id,
    reportId: sighting.reportId,
    estimate: estimate.estimate,
    count: estimate.count,
    replayed,
  }
}

/**
 * Ordering encodes the product's principles, as submitReport/help-offer/
 * panic-alert/rateHelper do:
 *
 *  1. Idempotency first (28/137): a replay of the same clientKey answers
 *     the SAME sighting and its CURRENT estimate — recomputed, since more
 *     sightings may have landed since the first accept — never a
 *     duplicate row and never re-judged against a rule that may have
 *     changed since.
 *  2. Report must exist (404) — existence is information (55).
 *  3. Category eligibility (201) — 422 DIRECTION_SIGHTING_NOT_ELIGIBLE:
 *     a sighting has no meaning for a category that does not flee.
 *  4. Report must be OPEN (422 BUSINESS_RULE, help-offers' wording) — a
 *     resolved case has nothing left to track.
 *  5. Self-dealing (200) — 422 BUSINESS_RULE, mirrors help-offers.service
 *     EXACTLY: only an IDENTIFIED reporter sighting their OWN report is
 *     blocked; a fully anonymous actor is covered by the accountability
 *     log (23), not by this check (help-offers' own documented posture).
 *  6. Legal Gate before any write (451) — location.tracking (7/22/26).
 *  7. Resolve the identified-vs-anonymous weight (27/205) from env,
 *     insert (append-only log + O(1) aggregate update, one transaction).
 *  8. Accountability for the anonymous sighter (23), never blocking (123).
 *  9. Synchronous reconciliation (22): the response already carries the
 *     estimate/count, ungated by the disclosure floor (202) — the actor
 *     who just acted gets full, private feedback; only READ paths (report
 *     detail, feed) are floor-gated (see reports.service.ts /
 *     help-matching.service.ts).
 */
export async function logDirectionSighting(
  input: LogDirectionSightingInput,
  actor: DirectionSightingActor
): Promise<LogDirectionSightingResult> {
  const existing = await repository.findSightingByClientKey(input.clientKey)
  if (existing) {
    const estimate = await currentEstimate(existing.reportId)
    return toResult(existing, estimate, true)
  }

  const report = await repository.findReportForSighting(input.reportId)
  if (!report) throw notFound()

  if (!isDirectionSightingEligible(report.category)) {
    throw new HttpError(
      422,
      'This report category does not support direction sighting',
      undefined,
      ErrorCodes.DIRECTION_SIGHTING_NOT_ELIGIBLE
    )
  }

  if (report.status !== 'open') {
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }

  // Decision 200: the reporter cannot sight their own report. Applies
  // whenever both sides are identifiable; a fully anonymous actor is
  // covered by the accountability log (23), not by this check — the
  // EXACT posture of help-offers.service.ts's submitHelpOffer (decision
  // 20). We deliberately do NOT compare an anonymous sighter's clientKey
  // against the report's own client_key — that check was never built for
  // help-offers either, and building it here would be new, unrequested
  // scope.
  if (actor.accountId !== null && report.reporterAccountId === actor.accountId) {
    throw new HttpError(
      422,
      'The reporter cannot sight a direction on their own report',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await assertCapability(Capabilities.LOCATION_TRACKING, {
    userRef: actor.accountId === null ? undefined : String(actor.accountId),
    ip: actor.ip,
  })

  const config = directionSightingConfig()
  const weight = actor.accountId === null ? config.weightAnonymous : config.weightIdentified

  const sighting: DirectionSightingRow = await repository.insertSighting({
    reportId: input.reportId,
    direction: input.direction,
    weight,
    accountId: actor.accountId,
    clientKey: input.clientKey,
  })

  if (actor.accountId === null) {
    try {
      // Decision 23: the anonymous sighter's act leaves the forensic
      // trail — the sighting id only — and, like help_offer.submit,
      // never blocks the flow (123).
      await appendAccountabilityLogEntry('direction_sighting.log', actor.ip, { sightingId: sighting.id })
    } catch (err) {
      logger.error('Accountability write failed for direction_sighting.log', { err, sightingId: sighting.id })
    }
  }

  const estimate = await currentEstimate(input.reportId)
  return toResult(sighting, estimate, false)
}
