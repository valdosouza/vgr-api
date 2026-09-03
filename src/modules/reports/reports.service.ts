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
import { CATEGORIES } from '@shared/taxonomy/taxonomy'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import {
  FieldDefinition,
  getCategoryFormSchema,
  validateReportDetailFields,
} from '@shared/risk/category-form'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { getRiskTier } from '@shared/risk/risk-tier'
import { degradePosition, degradeTimestamp } from '@shared/geo/degrade'
import { mediaConfig } from '@shared/config/env'
import { MediaVariant, openMediaObject } from '@shared/storage/media-object'
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

/**
 * The category detail-form catalog for the APP (decision 47, A1): one
 * anonymous read returns every category's schema so the form renders —
 * and validates — offline from a local cache. The TTL cache in
 * shared/risk/category-form keeps this cheap; the server remains the
 * validation authority on submit.
 */
export async function getCategoryForms(): Promise<
  Array<{ category: string; fields: FieldDefinition[] }>
> {
  return Promise.all(
    CATEGORIES.map(async (category) => ({
      category,
      fields: await getCategoryFormSchema(category),
    }))
  )
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
  // The case's evidence runs on the SAME retention clock (decision 131) —
  // the media-expiry job crypto-shreds it when the report purges.
  await repository.stampAttachedMediaExpiry(reportId, expiresAt)
  await repository.appendTimelineEvent(reportId, 'resolved', null)
  return { reportId, status: 'resolved' }
}

/**
 * AttachMedia (M2 — decisions 129/134/136/138, amendment E4). The
 * publicId is the bearer secret for ANONYMOUS media (134): whoever
 * presents it may attach it — once, consuming 'pending'. Account-owned
 * media only attaches through the same account. The Legal Gate capability
 * `report.media` (138) is asserted in the service so the offline queue
 * (28) is covered like submit.
 */
export async function attachMedia(
  reportId: number,
  mediaPublicId: string,
  viewer: ViewerContext,
  ip: string
): Promise<{ reportId: number; mediaPublicId: string; replayed: boolean }> {
  const report = await livingReport(reportId)
  if (!owns(report, viewer)) throw notFound()
  if (report.status !== 'open') {
    throw new HttpError(422, 'Report is already resolved', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (report.frozen) {
    throw new HttpError(422, 'Report is frozen', undefined, ErrorCodes.BUSINESS_RULE)
  }

  await assertCapability(Capabilities.REPORT_MEDIA, {
    userRef: viewer.accountId === null ? undefined : String(viewer.accountId),
    ip,
  })

  // Media problems answer 404, never 403 — whether a publicId exists is
  // itself information (the M1 posture).
  const mediaNotFound = () => new HttpError(404, 'Media not found', undefined, ErrorCodes.NOT_FOUND)
  const media = await repository.findMediaByPublicId(mediaPublicId)
  if (!media || !media.dekWrapped) throw mediaNotFound()
  if (media.uploaderAccountId !== null && media.uploaderAccountId !== viewer.accountId) {
    // Decision 134: account media only attaches through the same account.
    throw mediaNotFound()
  }
  if (media.class !== 'evidence') {
    throw new HttpError(422, 'Only evidence media can be attached', undefined, ErrorCodes.BUSINESS_RULE)
  }
  if (media.status !== 'pending' && media.status !== 'available') throw mediaNotFound()

  if (media.status === 'available') {
    // 'available' means SOME attach already consumed it (M2 lifecycle):
    // to this report = an offline-queue replay (same 200 as submit, 137);
    // to another = the one-attach rule of decision 134.
    if (await repository.isMediaLinked(reportId, media.id)) {
      return { reportId, mediaPublicId, replayed: true }
    }
    throw new HttpError(409, 'Media is already attached', undefined, ErrorCodes.DUPLICATE)
  }

  const attached = await repository.countAttachedMedia(reportId)
  if (attached >= mediaConfig().maxPerReport) {
    throw new HttpError(422, 'Report media limit reached', undefined, ErrorCodes.BUSINESS_RULE, {
      max: String(mediaConfig().maxPerReport),
    })
  }

  const outcome = await repository.attachMedia(reportId, { id: media.id, publicId: media.publicId })
  if (outcome === 'already_linked') return { reportId, mediaPublicId, replayed: true }
  if (outcome === 'not_pending') {
    // Raced with another attach that consumed the state first (134).
    throw new HttpError(409, 'Media is already attached', undefined, ErrorCodes.DUPLICATE)
  }

  if (viewer.accountId === null) {
    try {
      // Decision 134: every anonymous attach leaves the forensic trail of
      // decision 23 — and, like submit, never blocks the flow (123).
      await appendAccountabilityLogEntry('report.media.attach', ip, { reportId, mediaPublicId })
    } catch (err) {
      logger.error('Accountability write failed for report.media.attach', { err, reportId })
    }
  }

  return { reportId, mediaPublicId, replayed: false }
}

/**
 * Report-scoped media serving (M2 — the ONLY way anonymous-owned evidence
 * is ever read back). Access follows GetReportVisibility (50/135):
 * owner/participant get any derivative; the public gets derivatives of an
 * OPEN case only — and on a high-tier category only the blur (decision
 * 128: the sharp derivative never reaches a client to be "un-blurred").
 * The EXIF original never leaves the audited panel flow (130).
 */
export async function getReportMediaVariant(
  reportId: number,
  mediaPublicId: string,
  variant: MediaVariant,
  viewer: ViewerContext
): Promise<{ data: Buffer; mime: string }> {
  const report = await livingReport(reportId)
  const media = await repository.findAttachedMedia(reportId, mediaPublicId)
  // Blocked (moderation hold) disappears from the app plane — the panel
  // keeps reading it (M3); shredded is gone for everyone.
  if (!media || media.status !== 'available' || !media.dekWrapped) throw notFound()
  if (variant === 'original') throw notFound()

  const isOwner = owns(report, viewer)
  const isParticipant =
    !isOwner &&
    viewer.accountId !== null &&
    (await repository.hasOfferByAccount(report.id, viewer.accountId))

  if (!isOwner && !isParticipant) {
    // A hidden case is gone for third parties, its media with it (162).
    if (report.hidden) throw notFound()
    // Third parties: a resolved case shows only the closure summary (50).
    if (report.status !== 'open') throw notFound()
    const tier = await getRiskTier(report.category)
    if (tier === 'high' && variant !== 'blur') throw notFound()
  }

  const data = await openMediaObject(media.storagePrefix, media.dekWrapped, variant)
  if (!data) throw notFound()
  return { data, mime: media.mime }
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
    // Hidden by moderation (162): gone from the public detail AND from the
    // closure summary — 404, never a hint that it exists.
    if (report.hidden) throw notFound()
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
      // publicIds only — the media route decides which derivative this
      // viewer may fetch (blur-only on high tier, decision 128).
      media: (await repository.listAttachedMedia(report.id)).map((m) => ({
        publicId: m.publicId,
      })),
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
    // Decision 167: owner and participants keep the case with an explicit
    // mark — and never the reason (it is the audit trail's, not theirs).
    hidden: report.hidden,
    timeline,
    media: (await repository.listAttachedMedia(report.id)).map((m) => ({
      publicId: m.publicId,
      mime: m.mime,
      width: m.width,
      height: m.height,
    })),
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
  // The WHOLE case in one act (141b): the attached evidence leaves the
  // media-expiry job's reach together with the report.
  await repository.setAttachedMediaFrozen(reportId, true)
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
  // The evidence thaws with the case and on the SAME restarted clock
  // (141b/141d) — never "expired yesterday while it was frozen".
  await repository.setAttachedMediaFrozen(reportId, false, newExpiresAt)
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
