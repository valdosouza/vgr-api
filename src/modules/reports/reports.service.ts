import * as repository from '@modules/reports/reports.repository'
import {
  SubmitReportContext,
  SubmitReportInput,
  SubmitReportResult,
} from '@modules/reports/reports.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { validateReportDetailFields } from '@shared/risk/category-form'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

/**
 * SubmitReport (spec task 02/03 as amended for R1). The ordering encodes
 * the product's principles:
 *
 *  1. Idempotency first (decision 137): an offline-queue replay (28) must
 *     succeed even if a rule changed since the first accept — the report
 *     already exists; re-judging it would punish a flaky network.
 *  2. Legal Gate before any write (decision 104, fail-closed): anonymous
 *     submission consumes `report.anonymous` — for BOTH the no-account
 *     case and the logged-in-choosing-anonymity case (decision 32): the
 *     jurisdiction blocks the CAPABILITY, not the missing token.
 *  3. Category detail fields validated against the admin schema (47).
 *  4. Insert + timeline 'created' (19) + accountability for anonymous
 *     actors (23 — IP envelope-encrypted, never the position).
 */
export async function submitReport(
  input: SubmitReportInput,
  ctx: SubmitReportContext
): Promise<SubmitReportResult> {
  const existing = await repository.findByClientKey(input.clientKey)
  if (existing) {
    return { reportId: existing.id, status: existing.status, replayed: true }
  }

  const anonymous = ctx.accountId === null || input.anonymous
  if (anonymous) {
    await assertCapability(Capabilities.REPORT_ANONYMOUS, {
      userRef: ctx.accountId === null ? undefined : String(ctx.accountId),
      ip: ctx.ip,
    })
  }

  if (input.category) {
    const errors = await validateReportDetailFields(input.category, input.detailFields ?? {})
    if (errors.length > 0) {
      throw new HttpError(
        422,
        'Detail fields do not match the category form',
        errors.map((message) => ({
          field: `detailFields.${message.split(' ')[0]}`,
          message,
          code: FieldErrorCodes.REQUIRED,
        })),
        ErrorCodes.VALIDATION_FAILED
      )
    }
  }

  let reportId: number
  try {
    reportId = await repository.insertReport({
      clientKey: input.clientKey,
      category: input.category,
      freeTag: input.freeTag,
      subject: input.subject,
      detailFields: input.detailFields,
      lat: input.lat,
      lng: input.lng,
      anonymous,
      // Kept even when the reporter CHOSE anonymity: the anonymity is
      // social/interface-level (decisions 23/32), never forensic.
      reporterAccountId: ctx.accountId,
    })
  } catch (err: any) {
    // Two replays racing: the unique client_key loses one insert — the
    // winner's row is the answer for both (decision 137).
    if (err?.code === 'ER_DUP_ENTRY') {
      const winner = await repository.findByClientKey(input.clientKey)
      if (winner) return { reportId: winner.id, status: winner.status, replayed: true }
    }
    throw err
  }

  await repository.appendTimelineEvent(reportId, 'created', null)

  if (anonymous) {
    try {
      // Never the position (decision 110) — the report row already holds
      // it under the report's own access rules.
      await appendAccountabilityLogEntry('report.submit', ctx.ip, { reportId })
    } catch (err) {
      // The accountability write must never take the report down with it
      // ("a denúncia nunca espera", 123) — but it is never silent either.
      logger.error('Accountability write failed for report.submit', { err, reportId })
    }
  }

  return { reportId, status: 'open', replayed: false }
}
