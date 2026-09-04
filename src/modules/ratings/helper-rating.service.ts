import * as repository from '@modules/ratings/helper-rating.repository'
import {
  HelperRatingRow,
  HelperReputation,
  RateHelperInput,
  RateHelperResult,
  RatingActor,
  RatingReportRow,
} from '@modules/ratings/helper-rating.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import { Capabilities } from '@shared/legal/capabilities'
import { assertCapability } from '@shared/legal/legal-gate'
import { K_ANONYMITY_FLOOR } from '@shared/stats/k-anonymity'
import logger from '@shared/logger/logger'

/**
 * RateHelper (RT1 of plano-rating.md — decisions 48, 178-189). The report
 * OWNER (account, or the anonymous reporter presenting the report's
 * clientKey — 134/137) rates ONE help offer of a RESOLVED case (181) with
 * an integer 1..5 (182), once (183). The score lands on the helper's
 * internal account (48/180) — even when the helper is anonymous to the
 * reporter — and nothing about the helper leaves this service (60/185).
 */

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)

/** Ownership as reports.service defines it: account match OR the bearer
 *  clientKey (decision 134 pattern). Non-owners get 404, never 403 (20:
 *  the helper never rates; 55: existence is information). */
function owns(report: RatingReportRow, actor: RatingActor): boolean {
  if (actor.accountId !== null && report.reporterAccountId === actor.accountId) return true
  return actor.clientKey !== null && report.clientKey === actor.clientKey
}

/** HelperRated minus helperInternalId (48/60): ids and the score only. */
function toResult(row: HelperRatingRow, replayed: boolean): RateHelperResult {
  return {
    ratingId: row.id,
    reportId: row.reportId,
    helpOfferId: row.helpOfferId,
    score: row.score,
    createdAt: row.createdAt.toISOString(),
    replayed,
  }
}

const alreadyRated = () =>
  new HttpError(409, 'This help offer is already rated', undefined, ErrorCodes.ALREADY_RATED)

/**
 * Ordering encodes the product's principles, as submitReport and the chat
 * post do:
 *  1. ownership (134) and the offer's membership -> 404, never 403;
 *  2. idempotency (137/183): the offer's existing rating answers a replay
 *     of the same clientKey as-is — even if the case was hidden since; a
 *     DIFFERENT clientKey on a rated offer is 409 ALREADY_RATED (183);
 *  3. case state (181/162): not resolved -> 409 RATING_CLOSED 'open',
 *     hidden -> 409 RATING_CLOSED 'hidden'; frozen changes nothing (187);
 *  4. helper without an account -> 422 RATING_NOT_ALLOWED (180);
 *  5. Legal Gate before any write (188) -> 451;
 *  6. append; the UNIQUE race is resolved by re-reading the winner;
 *  7. accountability for the ANONYMOUS owner (23), never blocking (123).
 */
export async function rateHelper(
  reportId: number,
  offerId: number,
  input: RateHelperInput,
  actor: RatingActor
): Promise<RateHelperResult> {
  const report = await repository.findReportForRating(reportId)
  // Purged (25/131) and deleted answer 404 — same posture as reports.
  if (!report || report.purged) throw notFound()
  if (!owns(report, actor)) throw notFound()

  const offer = await repository.findOfferForRating(offerId, report.id)
  if (!offer) throw notFound()

  const existing = await repository.findRatingByOffer(offer.id)
  if (existing) {
    if (existing.clientKey === input.clientKey) return toResult(existing, true)
    throw alreadyRated()
  }

  if (report.status !== 'resolved') {
    throw new HttpError(409, 'The report is not resolved yet', undefined, ErrorCodes.RATING_CLOSED, {
      reason: 'open',
    })
  }
  if (report.hidden) {
    throw new HttpError(409, 'The report is hidden', undefined, ErrorCodes.RATING_CLOSED, {
      reason: 'hidden',
    })
  }

  if (offer.helperAccountId === null) {
    throw new HttpError(
      422,
      'A helper without an account cannot be rated',
      undefined,
      ErrorCodes.RATING_NOT_ALLOWED
    )
  }

  await assertCapability(Capabilities.HELPER_RATING, {
    userRef: actor.accountId === null ? undefined : String(actor.accountId),
    ip: actor.ip,
  })

  const row = await repository.insertRating({
    helpOfferId: offer.id,
    reportId: report.id,
    // Kept even when the helper CHOSE anonymity toward the reporter —
    // social anonymity, internal identity (23/32/48/180).
    helperAccountId: offer.helperAccountId,
    score: input.score,
    clientKey: input.clientKey,
  })
  if (!row) {
    // A UNIQUE key collided: the offer's (another rating won the race) or
    // the clientKey's (a replay racing itself, 137). The winner decides.
    const winner = await repository.findRatingByOffer(offer.id)
    if (winner && winner.clientKey === input.clientKey) return toResult(winner, true)
    if (winner) throw alreadyRated()
    // No rating on this offer, yet the insert collided: the clientKey was
    // spent on ANOTHER offer's rating — an app bug, never a replay.
    throw new HttpError(
      409,
      'The clientKey was already used for another rating',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }

  if (actor.accountId === null) {
    try {
      // Decision 23: the anonymous owner's act leaves the forensic trail
      // (pattern of help_offer.submit) — the id, never the score — and,
      // like submit, never blocks the flow (123).
      await appendAccountabilityLogEntry('helper_rating.submit', actor.ip, { ratingId: row.id })
    } catch (err) {
      logger.error('Accountability write failed for helper_rating.submit', { err, ratingId: row.id })
    }
  }

  return toResult(row, false)
}

/**
 * GET /app-ratings/me (decisions 184/185): the caller's OWN aggregate,
 * by internal account id — count always, average only at or above the
 * k = 5 floor of shared/stats (164/165): below it the average IS the
 * individual score, and "case X gave me 1" points at the reporter (6/40).
 * Hidden cases are already out of the aggregate (187). Nothing per case,
 * ever; nobody else's reputation exists on the app plane.
 */
export async function getMyReputation(accountId: number): Promise<HelperReputation> {
  const aggregate = await repository.aggregateByHelperInternalId(accountId)
  const average =
    aggregate.count >= K_ANONYMITY_FLOOR && aggregate.average !== null
      ? Math.round(aggregate.average * 100) / 100
      : null
  return { count: aggregate.count, average }
}
