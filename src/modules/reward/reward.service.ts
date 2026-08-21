import * as repository from '@modules/reward/reward.repository'
import {
  CreateOfferContext,
  CreateOfferInput,
  MediationOutcome,
  OnboardContext,
  ReserveContext,
  ReserveInput,
  ResolveContext,
  RewardOfferRow,
} from '@modules/reward/reward.interface'
import { paymentRail, RecipientOnboardingInput } from '@shared/payment/payment-rail'
import { mediationContestWindowDays } from '@shared/config/env'
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
 *  - Chargeback repasse (decision 102) — Pix has no chargeback; only a
 *    MED edge case exists and is unhandled.
 *  - Expiration job (decisions 89/90, pending D1) — not needed for Pix
 *    per decision 95's note until D1 says otherwise.
 */

/**
 * Fills the gap reserveGuarantee's NOT_AVAILABLE error points at: the
 * helper hands their KYC data to the rail (their own PSP — decisions 60/82
 * govern disclosure to OTHER parties, not this), which opens the subconta
 * the split will target. The VGR stores only the opaque railRecipientId
 * (decision 143) — none of the KYC input is persisted or logged here.
 */
export async function onboardAsRecipient(
  input: RecipientOnboardingInput,
  ctx: OnboardContext
): Promise<void> {
  const existing = await repository.findRecipientProfile(ctx.accountId)
  if (existing) {
    throw new HttpError(
      409,
      'This account is already onboarded to receive payouts',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }

  // Onboarding sends personal data to the delegated rail in order to
  // receive money — both capabilities must be allowed in the jurisdiction
  // before anything leaves the platform (fail-closed, decision 104).
  await assertCapability(Capabilities.REWARD_MONETARY, { userRef: String(ctx.accountId) })
  await assertCapability(Capabilities.REWARD_INTERMEDIATION_DELEGATED, {
    userRef: String(ctx.accountId),
  })

  const { railRecipientId } = await paymentRail().onboardRecipient(input)
  await repository.insertRecipientProfile(ctx.accountId, railRecipientId)
}

/** Lets the app decide whether to show the onboarding flow before the
 *  helper is targeted by a reserve. Never exposes the rail id itself. */
export async function getOnboardingStatus(accountId: number): Promise<{ onboarded: boolean }> {
  const profile = await repository.findRecipientProfile(accountId)
  return { onboarded: profile !== null }
}

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

  // Decision 150: no published criteria, no reserve — a guarantee whose
  // mediation rules were never declared is the "fachada" decision 98
  // forbids. The active version is stamped and governs this case forever.
  const criteria = await repository.findActiveCriteria()
  if (!criteria) {
    throw new HttpError(
      422,
      'Mediation criteria have not been published yet',
      undefined,
      ErrorCodes.NOT_AVAILABLE
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

  await repository.markReserved(
    offer.id,
    railChargeId,
    input.noReturnNoticeVersion,
    criteria.version,
    input.recipients
  )
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
 * Mediation discipline (decision 98, closed by 148/149/150). The rail is
 * only ever touched by executeResolution, after the full cycle:
 * propose (mediator A) -> approve (mediator B, distinct — decision 148) ->
 * contest window (decision 149) -> execute. Every step lands in the
 * append-only mediation log (pattern of decision 76).
 */

/** The panel's handle is the case (report) id — same as case-freeze; the
 *  offer is 1:1 with the report (unique key), so nothing is ambiguous. */
async function reservedOffer(reportId: number): Promise<RewardOfferRow & { railChargeId: string }> {
  const offer = await repository.findOfferByReport(reportId)
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
  return offer as RewardOfferRow & { railChargeId: string }
}

/** Decision 150: publishing criteria is append-only — correcting means a
 *  new version. Version uniqueness is the DB's unique key. */
export async function publishCriteria(
  version: string,
  body: string,
  ctx: ResolveContext
): Promise<{ criteriaId: number }> {
  const existing = await repository.findCriteriaByVersion(version)
  if (existing) {
    throw new HttpError(
      409,
      'This criteria version is already published',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }
  return { criteriaId: await repository.insertCriteria(version, body, ctx.userId) }
}

/** The rules of the game, visible to the app's parties (decision 150). */
export async function getActiveCriteria(): Promise<{ version: string; body: string } | null> {
  const criteria = await repository.findActiveCriteria()
  return criteria ? { version: criteria.version, body: criteria.body } : null
}

/** Step 1 (decision 148): mediator A proposes, judging by the criteria
 *  version stamped on the offer at reserve time (decision 150). */
export async function proposeResolution(
  reportId: number,
  outcome: MediationOutcome,
  reason: string,
  ctx: ResolveContext
): Promise<{ resolutionId: number }> {
  const offer = await reservedOffer(reportId)
  if (await repository.findLiveResolution(offer.id)) {
    throw new HttpError(
      409,
      'A resolution is already in progress for this reward',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }

  await assertCapability(Capabilities.REWARD_MEDIATION, { userRef: String(ctx.userId) })

  const resolutionId = await repository.insertResolution(
    offer.id,
    outcome,
    reason,
    offer.criteriaVersion,
    ctx.userId
  )
  await repository.appendMediationLog(offer.id, 'proposed', `user:${ctx.userId}`, outcome)
  return { resolutionId }
}

/** Step 2 (decision 148): a DIFFERENT mediator approves; approval opens the
 *  contest window (decision 149), it does not touch the rail. */
export async function approveResolution(
  reportId: number,
  ctx: ResolveContext
): Promise<{ windowEndsAt: string }> {
  const offer = await reservedOffer(reportId)
  const resolution = await repository.findLiveResolution(offer.id)
  if (!resolution || resolution.status !== 'proposed') {
    throw new HttpError(422, 'No proposed resolution to approve', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (resolution.proposedBy === ctx.userId) {
    throw new HttpError(
      422,
      'The approver must be a different user than the proposer',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await assertCapability(Capabilities.REWARD_MEDIATION, { userRef: String(ctx.userId) })

  const windowEndsAt = new Date(
    Date.now() + mediationContestWindowDays() * 24 * 60 * 60 * 1000
  )
  await repository.approveResolution(resolution.id, ctx.userId, windowEndsAt)
  await repository.appendMediationLog(offer.id, 'approved', `user:${ctx.userId}`, null)
  return { windowEndsAt: windowEndsAt.toISOString() }
}

/** Decision 149: a case party contests while the money is still retained —
 *  the only contest with a real remedy (a released Pix never returns,
 *  decision 92). App plane; reportId is the app's handle. */
export async function contestResolution(
  reportId: number,
  body: string,
  ctx: ReserveContext
): Promise<{ contestId: number }> {
  const offer = await repository.findOfferByReport(reportId)
  if (!offer) {
    throw new HttpError(404, 'Reward offer not found', undefined, ErrorCodes.NOT_FOUND)
  }
  const resolution = await repository.findLiveResolution(offer.id)
  if (!resolution || resolution.executedAt) {
    throw new HttpError(
      422,
      'There is no resolution open to contest',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  const parties = await repository.findPartyAccountIds(offer.id)
  if (!parties.includes(ctx.accountId)) {
    throw new HttpError(
      403,
      'Only a party of the case can contest its resolution',
      undefined,
      ErrorCodes.FORBIDDEN
    )
  }

  const contestId = await repository.insertContest(resolution.id, ctx.accountId, body)
  await repository.appendMediationLog(offer.id, 'contested', `account:${ctx.accountId}`, null)
  return { contestId }
}

/** Decision 149: an open contest blocks execution until a mediator closes
 *  it with a note — the note is part of the immutable trail. */
export async function closeContest(
  contestId: number,
  note: string,
  ctx: ResolveContext
): Promise<void> {
  const contest = await repository.findContestById(contestId)
  if (!contest) {
    throw new HttpError(404, 'Contest not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (contest.status !== 'open') {
    throw new HttpError(422, 'Contest is already closed', undefined, ErrorCodes.BUSINESS_RULE)
  }
  const resolution = await repository.findResolutionById(contest.resolutionId)
  await repository.closeContest(contestId, ctx.userId, note)
  await repository.appendMediationLog(
    resolution!.rewardOfferId,
    'contest_closed',
    `user:${ctx.userId}`,
    note
  )
}

/** Abandoning a proposal (e.g. a contest convinced the mediators) — a new
 *  propose/approve cycle (decision 148) can then start. */
export async function cancelResolution(reportId: number, ctx: ResolveContext): Promise<void> {
  const offer = await reservedOffer(reportId)
  const resolution = await repository.findLiveResolution(offer.id)
  if (!resolution) {
    throw new HttpError(422, 'No live resolution to cancel', undefined, ErrorCodes.BUSINESS_RULE)
  }
  await repository.cancelResolution(resolution.id)
  await repository.appendMediationLog(offer.id, 'cancelled', `user:${ctx.userId}`, null)
}

/** State for the future panel screen: the live resolution, its open
 *  contests and the full immutable trail. */
export async function getMediationState(reportId: number): Promise<{
  offer: RewardOfferRow
  resolution: Awaited<ReturnType<typeof repository.findLiveResolution>>
  openContests: Awaited<ReturnType<typeof repository.findOpenContests>>
  log: Awaited<ReturnType<typeof repository.findMediationLog>>
}> {
  const offer = await repository.findOfferByReport(reportId)
  if (!offer) {
    throw new HttpError(404, 'Reward offer not found', undefined, ErrorCodes.NOT_FOUND)
  }
  const resolution = await repository.findLiveResolution(offer.id)
  return {
    offer,
    resolution,
    openContests: resolution ? await repository.findOpenContests(resolution.id) : [],
    log: await repository.findMediationLog(offer.id),
  }
}

/**
 * The ONLY place the rail is instructed (decisions 148/149): requires an
 * approved resolution, an elapsed contest window and no open contest.
 * Ministerial after dual approval — any mediator may pull the trigger.
 * `fulfilled` releases exactly to the fixed set; `not_fulfilled` refunds
 * the payer (decision 100 point 3; decision 92 only forbids reversal
 * AFTER a release).
 */
export async function executeResolution(reportId: number, ctx: ResolveContext): Promise<void> {
  const offer = await reservedOffer(reportId)
  const resolution = await repository.findLiveResolution(offer.id)
  if (!resolution || resolution.status !== 'approved' || !resolution.windowEndsAt) {
    throw new HttpError(422, 'No approved resolution to execute', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (resolution.windowEndsAt.getTime() > Date.now()) {
    throw new HttpError(
      422,
      'The contest window has not elapsed yet',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }
  if ((await repository.findOpenContests(resolution.id)).length > 0) {
    throw new HttpError(
      422,
      'An open contest blocks execution',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await assertCapability(Capabilities.REWARD_MEDIATION, { userRef: String(ctx.userId) })

  if (resolution.outcome === 'fulfilled') {
    await paymentRail().capture(offer.railChargeId)
    await repository.markResolved(offer.id, 'released')
  } else {
    await paymentRail().cancel(offer.railChargeId)
    await repository.markResolved(offer.id, 'refunded')
  }
  await repository.markResolutionExecuted(resolution.id)
  await repository.appendMediationLog(offer.id, 'executed', `user:${ctx.userId}`, resolution.outcome)
}
