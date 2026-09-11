import * as repository from '@modules/help-offers/help-offers.repository'
import {
  SubmitHelpOfferContext,
  SubmitHelpOfferInput,
  UpdateHelpOfferTypesContext,
  UpdateHelpOfferTypesInput,
} from '@modules/help-offers/help-offers.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

/** SubmitHelpOffer (spec task 06, decisions 10/18/20/34/35; 208 — a SET
 *  of fronts per offer). */
export async function submitHelpOffer(
  input: SubmitHelpOfferInput,
  ctx: SubmitHelpOfferContext
): Promise<{ helpOfferId: number }> {
  const report = await repository.findReportForOffer(input.reportId)
  if (!report) {
    throw new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (report.status !== 'open') {
    // Resolution KEEPS existing offers linked (decision 18); it only
    // closes the door to new ones.
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }
  // Anti-fraud (decision 20): the reporter never helps their own report.
  // Applies whenever both sides are identifiable; fully anonymous actors
  // are covered by the accountability log (23), not by this check.
  if (ctx.accountId !== null && report.reporterAccountId === ctx.accountId) {
    throw new HttpError(
      422,
      'The reporter cannot be a helper on their own report',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  const anonymous = ctx.accountId === null || input.anonymous

  let helpOfferId: number
  try {
    helpOfferId = await repository.insertHelpOffer({
      reportId: input.reportId,
      // Kept even when the helper CHOSE anonymity — social anonymity,
      // forensic accountability (decisions 23/32, same as the report).
      helperAccountId: ctx.accountId,
      anonymous,
      helpTypes: input.helpTypes,
    })
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new HttpError(
        409,
        'You already offered help on this report',
        undefined,
        ErrorCodes.DUPLICATE
      )
    }
    throw err
  }

  // Timeline event (decisions 18/19/212) — NEVER the helper's identity: the
  // timeline is participant-visible and identification is the helper's
  // choice (6), masked outright on high tier (40/60).
  await repository.appendHelpOfferedEvent(input.reportId, input.helpTypes)

  if (ctx.accountId === null) {
    try {
      await appendAccountabilityLogEntry('help_offer.submit', ctx.ip, { helpOfferId })
    } catch (err) {
      logger.error('Accountability write failed for help_offer.submit', { err, helpOfferId })
    }
  }

  return { helpOfferId }
}

/** UpdateHelpOfferTypes (decision 211): the helper who made the offer
 *  swaps its whole set of fronts while the report is open. Only an offer
 *  with an account behind it can be claimed — a fully anonymous offer has
 *  no identity and no client key (032), so nothing could prove it is the
 *  same device (same posture as decision 169 for the chat). A logged-in
 *  helper who CHOSE anonymity still matches by account: the check is
 *  ownership, not display. */
export async function updateHelpOfferTypes(
  input: UpdateHelpOfferTypesInput,
  ctx: UpdateHelpOfferTypesContext
): Promise<{ helpOfferId: number; helpTypes: UpdateHelpOfferTypesInput['helpTypes'] }> {
  const offer = await repository.findOfferForUpdate(input.helpOfferId)
  // Someone else's offer is indistinguishable from a missing one — never a
  // hint that it exists (same rule the report views follow).
  if (!offer || offer.helperAccountId !== ctx.accountId) {
    throw new HttpError(404, 'Help offer not found', undefined, ErrorCodes.NOT_FOUND)
  }
  if (offer.reportStatus !== 'open') {
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }

  await repository.replaceHelpOfferTypes(offer.id, input.helpTypes)
  await repository.appendHelpOfferUpdatedEvent(offer.reportId, input.helpTypes)

  return { helpOfferId: offer.id, helpTypes: input.helpTypes }
}
