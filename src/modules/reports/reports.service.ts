import * as repository from '@modules/reports/reports.repository'
import {
  CaseFreezeState,
  EditReportInput,
  ReportRow,
  ReportView,
  SubmitReportContext,
  SubmitReportInput,
  SubmitReportResult,
  ViewerContext,
} from '@modules/reports/reports.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { validateReportDetailFields } from '@shared/risk/category-form'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { getRiskTier } from '@shared/risk/risk-tier'
import { degradePosition, degradeTimestamp } from '@shared/geo/degrade'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

const RETENTION_DAYS = 90

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

/** Ownership (R3): the account matches, OR the viewer presents the
 *  report's clientKey — the bearer-secret pattern of decision 134: the
 *  anonymous reporter's app kept the key it generated (137). */
function owns(report: ReportRow, viewer: ViewerContext): boolean {
  if (viewer.accountId !== null && report.reporterAccountId === viewer.accountId) return true
  return viewer.clientKey !== null && report.clientKey === viewer.clientKey
}

const notFound = () => new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)

/** Loads a living report; purged (25/131) and deleted answer 404. */
async function livingReport(reportId: number): Promise<ReportRow> {
  const report = await repository.findById(reportId)
  if (!report || report.purged) throw notFound()
  return report
}

/**
 * EditReport (spec, decision 19): owner-only, open cases only. A frozen
 * case is evidence in an authority's hands (141) — nobody edits it, not
 * even the owner.
 */
export async function editReport(
  reportId: number,
  input: EditReportInput,
  viewer: ViewerContext
): Promise<{ reportId: number; changedFields: string[] }> {
  const report = await livingReport(reportId)
  // Non-owners get the same 404 as a missing id — whether a report exists
  // is itself information (same posture as media).
  if (!owns(report, viewer)) throw notFound()
  if (report.status !== 'open') {
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (report.frozen) {
    throw new HttpError(422, 'Report is frozen', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (input.freeTag !== undefined && report.freeTag === null) {
    // The taxonomy axes are immutable (140) — a free tag only exists on a
    // free-tag report; reclassification is a moderation concern.
    throw new HttpError(
      422,
      'Only free-tag reports can change the tag',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }
  if (input.detailFields !== undefined && report.category) {
    const errors = await validateReportDetailFields(report.category, input.detailFields)
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

  const changedFields = Object.keys(input)
  await repository.updateEditableFields(reportId, input)
  // Helpers stay linked and see the edit on the timeline (decision 19).
  await repository.appendTimelineEvent(reportId, 'edited', { changedFields })
  return { reportId, changedFields }
}

/**
 * ResolveReport (spec, decisions 18/131): owner-only; atomic against a
 * double resolve; stamps expires_at = +90 days — the retention clock the
 * purge job consumes. Existing help offers STAY linked (18); the timeline
 * event is their in-app closure notice (push delivery is out of MVP scope
 * per the spec's event table).
 */
export async function resolveReport(
  reportId: number,
  viewer: ViewerContext
): Promise<{ reportId: number; status: 'resolved' }> {
  const report = await livingReport(reportId)
  if (!owns(report, viewer)) throw notFound()

  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const transitioned = await repository.markResolved(reportId, expiresAt)
  if (!transitioned) {
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }
  await repository.appendTimelineEvent(reportId, 'resolved', null)
  return { reportId, status: 'resolved' }
}

/**
 * GetReportVisibility (spec task 25, decisions 24/41/50/55/60/135).
 *  - owner: everything, plus the offers list (masked per tier);
 *  - identified helper with an offer: everything but other helpers;
 *  - anyone else, open case: degraded public view (same grid as the feed
 *    — shared/geo/degrade — or the sharper one betrays the position);
 *  - anyone else, resolved case: closure summary only (50).
 */
export async function getReportView(reportId: number, viewer: ViewerContext): Promise<ReportView> {
  const report = await livingReport(reportId)
  const tier = await getRiskTier(report.category)
  const common = {
    reportId: report.id,
    category: report.category,
    freeTag: report.freeTag,
    subject: report.subject,
    tier,
  }

  const isOwner = owns(report, viewer)
  const isParticipant =
    !isOwner &&
    viewer.accountId !== null &&
    (await repository.hasOfferByAccount(report.id, viewer.accountId))

  if (!isOwner && !isParticipant) {
    if (report.status === 'resolved') {
      return {
        access: 'summary',
        ...common,
        status: 'resolved',
        resolvedAt: degradeTimestamp(report.resolvedAt as Date, tier),
      }
    }
    return {
      access: 'public',
      ...common,
      status: 'open',
      position: degradePosition({ lat: report.lat as number, lng: report.lng as number }, tier),
      detailFields: report.detailFields,
      createdAt: degradeTimestamp(report.createdAt, tier),
    }
  }

  const timeline = (await repository.getTimeline(report.id)).map((event) => ({
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  }))

  const view: ReportView = {
    access: isOwner ? 'owner' : 'participant',
    ...common,
    status: report.status,
    position: { lat: report.lat as number, lng: report.lng as number },
    detailFields: report.detailFields,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    timeline,
  }

  if (isOwner) {
    const offers = await repository.findOffersWithNames(report.id)
    view.offers = offers.map((row) => ({
      helpOfferId: row.id,
      helpType: row.helpType,
      // Identity only when the helper chose it AND the tier allows it
      // (decisions 6/40/60); timestamps never on high tier (41).
      helperDisplayName: row.anonymous || tier === 'high' ? null : row.helperDisplayName,
      createdAt: tier === 'high' ? null : row.createdAt.toISOString(),
    }))
  }

  return view
}

/**
 * Freeze (decisions 141/142 — "não podemos destruir provas"). ONE human
 * with the case_freeze grant, mandatory reason (writ/case number). NO
 * timeline event on purpose: the timeline is participant-visible and a
 * freeze would tip off a reporter under investigation. The audit row
 * (decision 116) is written by the controller.
 */
export async function freezeCase(
  reportId: number,
  reason: string
): Promise<{ reportId: number; frozen: true }> {
  await livingReport(reportId)
  const transitioned = await repository.freeze(reportId, reason)
  if (!transitioned) {
    throw new HttpError(422, 'Case is already frozen', undefined, ErrorCodes.BUSINESS_RULE)
  }
  return { reportId, frozen: true }
}

/** Unfreeze step 1 (decision 141d): a human REQUESTS, with a reason. */
export async function requestUnfreeze(
  reportId: number,
  reason: string,
  requestedBy: number
): Promise<{ requestId: number }> {
  const report = await livingReport(reportId)
  if (!report.frozen) {
    throw new HttpError(422, 'Case is not frozen', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (await repository.findPendingUnfreeze(reportId)) {
    throw new HttpError(
      409,
      'An unfreeze request is already pending',
      undefined,
      ErrorCodes.DUPLICATE
    )
  }
  return { requestId: await repository.insertUnfreezeRequest(reportId, reason, requestedBy) }
}

/**
 * Unfreeze step 2 (decision 141d): a DIFFERENT human approves —
 * unfreezing re-arms destruction, so it carries the dual-control friction
 * (pattern of decisions 45/107). The retention clock RESTARTS: a resolved
 * case gets a fresh 90 days from now, never "expired yesterday while it
 * was frozen"; an open case keeps no expiry until it resolves.
 */
export async function approveUnfreeze(
  reportId: number,
  approvedBy: number
): Promise<{ reportId: number; frozen: false }> {
  const report = await livingReport(reportId)
  const pending = await repository.findPendingUnfreeze(reportId)
  if (!report.frozen || !pending) {
    throw new HttpError(422, 'No pending unfreeze request', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (pending.requestedBy === approvedBy) {
    throw new HttpError(
      422,
      'The approver must be a different user than the requester',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }

  await repository.approveUnfreezeRequest(pending.id, approvedBy)
  const newExpiresAt =
    report.status === 'resolved'
      ? new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000)
      : null
  await repository.unfreeze(reportId, newExpiresAt)
  return { reportId, frozen: false }
}

/** State for the ONE panel screen this front adds (decision 142). */
export async function getCaseFreezeState(reportId: number): Promise<CaseFreezeState> {
  const report = await livingReport(reportId)
  const pending = await repository.findPendingUnfreeze(reportId)
  return {
    reportId: report.id,
    status: report.status,
    frozen: report.frozen,
    frozenReason: report.frozenReason,
    frozenAt: report.frozenAt ? report.frozenAt.toISOString() : null,
    pendingUnfreeze: pending
      ? {
          reason: pending.reason,
          requestedBy: pending.requestedBy,
          requestedAt: pending.requestedAt.toISOString(),
        }
      : null,
  }
}

/**
 * Retention purge (decisions 25/131), registered in the scheduler next to
 * media-expiry. Frozen cases are never selected (141); what purge means —
 * nulled payloads, kept skeleton — is the repository's contract.
 */
export async function purgeExpiredReports(): Promise<{ purged: number }> {
  let purged = 0
  for (;;) {
    const due = await repository.findExpiredReports(100)
    if (due.length === 0) break
    for (const id of due) {
      await repository.purgeReport(id)
      purged += 1
    }
    if (due.length < 100) break
  }
  if (purged > 0) {
    logger.info(`Report retention: purged ${purged} expired reports`)
  }
  return { purged }
}
