import * as repository from '@modules/reward/reward.repository'
import {
  CreateOfferContext,
  CreateOfferInput,
  MediationOutcome,
  ReserveContext,
  ReserveInput,
  ResolveContext,
  RewardOfferRow,
} from '@modules/reward/reward.interface'
import { paymentRail } from '@shared/payment/payment-rail'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

/**
 * Reward domain — R0 (first slice), decisions 1/30/81-102/143-147.
 * Scope: MONETARY reward only (the guarantee mechanism). Non-monetary
 * reward (decision 1's broader "flexible, not necessarily financial") is
 * not modeled here — this table only exists once money is involved.
 *
 * Deliberately NOT built in this slice — documented, not silently
 * skipped (see api/docs/feature/reward.md):
 *  - Mediation criteria publication / dual control above a value
 *    threshold (decision 98's discipline) — resolveReward only checks a
 *    privilege today.
 *  - Chargeback repasse (decision 102) — Pix has no chargeback; only a
 *    MED edge case exists and is unhandled.
 *  - Expiration job (decisions 89/90, pending D1) — not needed for Pix
 *    per decision 95's note until D1 says otherwise.
 *  - Helper onboarding endpoint that produces a railRecipientId —
 *    reserveGuarantee throws a typed, catchable error when a targeted
 *    helper has none yet.
 */

export async function offerReward(
  input: CreateOfferInput,
  ctx: CreateOfferContext
): Promise<{ offerId: number }> {
  const report = await repository.findReportForOffer(input.reportId)
  if (!report) {
    throw new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (report.reporterAccountId !== ctx.accountId) {
    throw new HttpError(403, 'Only the reporter can offer a reward', undefined, ErrorCodes.FORBIDDEN)
  }

  const existing = await repository.findOfferByReport(input.reportId)
  if (existing) {
    throw new HttpError(
      409,
      'This report already has a reward offer',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }

  await assertCapability(Capabilities.REWARD_OFFER, { userRef: String(ctx.accountId) })
  await assertCapability(Capabilities.REWARD_MONETARY, { userRef: String(ctx.accountId) })

  const offerId = await repository.insertOffer(input)
  return { offerId }
}

/**
 * Decision 88: the denunciante's later, explicit choice to reserve via Pix.
 * Decision 147: the recipient set named here is FIXED — it is never
 * revisited by mediation, only judged fulfilled or not as a whole.
 */
export async function reserveGuarantee(input: ReserveInput, ctx: ReserveContext): Promise<void> {
  const offer = await repository.findOfferByReport(input.reportId)
  if (!offer) {
    throw new HttpError(404, 'Reward offer not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (offer.status !== 'open') {
    throw new HttpError(
      422,
      'Reward is not open for reservation',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await assertCapability(Capabilities.REWARD_INTERMEDIATION_DELEGATED, {
    userRef: String(ctx.accountId),
  })

  const totalCents = input.recipients.reduce((sum, r) => sum + r.amountCents, 0)
  if (totalCents !== offer.amountCents) {
    throw new HttpError(
      422,
      'Recipient amounts must add up to the offered amount',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  const helpOffers = await repository.findHelpOffersForRecipients(
    input.reportId,
    input.recipients.map((r) => r.helpOfferId)
  )
  if (helpOffers.length !== input.recipients.length) {
    throw new HttpError(
      422,
      'One or more help offers do not belong to this report',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  const railRecipients: Array<{ railRecipientId: string; amountCents: number }> = []
  for (const target of input.recipients) {
    const helpOffer = helpOffers.find((h) => h.id === target.helpOfferId)!
    if (helpOffer.helperAccountId === null) {
      // Decision 34's precedent: an anonymous helper is informed up front
      // they cannot claim a reward — this is that rule enforced server-side.
      throw new HttpError(
        422,
        'An anonymous helper cannot receive a monetary reward',
        undefined,
        ErrorCodes.BUSINESS_RULE
      )
    }
    const profile = await repository.findRecipientProfile(helpOffer.helperAccountId)
    if (!profile) {
      throw new HttpError(
        422,
        'Helper has not onboarded to receive a payout yet',
        undefined,
        ErrorCodes.NOT_AVAILABLE
      )
    }
    railRecipients.push({ railRecipientId: profile.railRecipientId, amountCents: target.amountCents })
  }

  const { railChargeId } = await paymentRail().reserve({
    amountCents: offer.amountCents,
    payerTaxId: input.payerTaxId,
    payerName: input.payerName,
    recipients: railRecipients,
  })

  await repository.markReserved(offer.id, railChargeId, input.noReturnNoticeVersion, input.recipients)
}

/**
 * Decision 85: the seal shown to the app must derive from the LIVE rail
 * state, never a stored boolean. Reconciles drift on read instead of
 * waiting for the next mutation or an expiration job (neither built here).
 */
export async function getRewardState(reportId: number): Promise<RewardOfferRow | null> {
  const offer = await repository.findOfferByReport(reportId)
  if (!offer) return null
  if (offer.status !== 'reserved' || !offer.railChargeId) return offer

  const liveState = await paymentRail().getRetentionState(offer.railChargeId)
  if (liveState === 'retained') return offer

  const mapped = liveState === 'refunded' ? 'refunded' : liveState === 'released' ? 'released' : null
  if (mapped) {
    await repository.updateOfferStatus(offer.id, mapped)
    return { ...offer, status: mapped }
  }
  return offer
}

/**
 * Decision 98/147: mediation judges whether the condition was fulfilled
 * for the recipient set fixed at reserve time — it does not choose who
 * receives. `fulfilled` releases exactly to that set; `not_fulfilled`
 * refunds the denunciante (decision 100 point 3 — devolver is first-class,
 * decision 92 only forbids reversal AFTER a release).
 */
export async function resolveReward(
  offerId: number,
  outcome: MediationOutcome,
  ctx: ResolveContext
): Promise<void> {
  const offer = await repository.findOfferById(offerId)
  if (!offer) {
    throw new HttpError(404, 'Reward offer not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (offer.status !== 'reserved' || !offer.railChargeId) {
    throw new HttpError(
      422,
      'Reward is not in a reserved state',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await assertCapability(Capabilities.REWARD_MEDIATION, { userRef: String(ctx.userId) })

  if (outcome === 'fulfilled') {
    await paymentRail().capture(offer.railChargeId)
    await repository.markResolved(offer.id, 'released')
  } else {
    await paymentRail().cancel(offer.railChargeId)
    await repository.markResolved(offer.id, 'refunded')
  }
}
