import * as repository from '@modules/help-offers/help-offers.repository'
import {
  SubmitHelpOfferContext,
  SubmitHelpOfferInput,
} from '@modules/help-offers/help-offers.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

/** SubmitHelpOffer (spec task 06, decisions 10/18/20/34/35). */
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
      helpType: input.helpType,
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

  // Timeline event (decisions 18/19) — NEVER the helper's identity: the
  // timeline is participant-visible and identification is the helper's
  // choice (6), masked outright on high tier (40/60).
  await repository.appendHelpOfferedEvent(input.reportId, input.helpType)

  if (ctx.accountId === null) {
    try {
      await appendAccountabilityLogEntry('help_offer.submit', ctx.ip, { helpOfferId })
    } catch (err) {
      logger.error('Accountability write failed for help_offer.submit', { err, helpOfferId })
    }
  }

  return { helpOfferId }
}
