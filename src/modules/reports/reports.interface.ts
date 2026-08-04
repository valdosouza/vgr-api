/** Taxonomy moved to @shared/taxonomy/taxonomy when help-matching became
 *  the second consumer (amendment E8 pattern) — re-exported here to keep
 *  the module surface stable. */
export { CATEGORIES, SUBJECTS } from '@shared/taxonomy/taxonomy'
export type { Category, Subject } from '@shared/taxonomy/taxonomy'
import type { Category, Subject } from '@shared/taxonomy/taxonomy'

export type ReportStatus = 'open' | 'resolved'

export interface ReportRow {
  id: number
  clientKey: string
  category: Category | null
  freeTag: string | null
  subject: Subject
  detailFields: Record<string, unknown> | null
  /** Null only after purge (decisions 25/131) — purged rows 404 on read. */
  lat: number | null
  lng: number | null
  anonymous: boolean
  reporterAccountId: number | null
  status: ReportStatus
  resolvedAt: Date | null
  expiresAt: Date | null
  frozen: boolean
  frozenReason: string | null
  frozenAt: Date | null
  purged: boolean
  createdAt: Date
}

export interface SubmitReportInput {
  clientKey: string
  category: Category | null
  freeTag: string | null
  subject: Subject
  detailFields: Record<string, unknown> | null
  lat: number
  lng: number
  /** Explicit anonymity choice (decision 32). Forced true when there is
   *  no authenticated account. */
  anonymous: boolean
}

export interface SubmitReportContext {
  /** From optionalAppAuth — null on anonymous requests. */
  accountId: number | null
  ip: string
}

export interface SubmitReportResult {
  reportId: number
  status: ReportStatus
  /** True when the clientKey had already been accepted (decision 137) —
   *  the controller answers 200 instead of 201. */
  replayed: boolean
}

/**
 * Who is looking (R3). Ownership is proved by the account OR by
 * presenting the report's clientKey — the bearer-secret pattern of
 * decision 134 applied to reports: the anonymous reporter's app kept the
 * key it generated (137), and that key IS the ownership proof.
 */
export interface ViewerContext {
  accountId: number | null
  clientKey: string | null
}

export interface EditReportInput {
  freeTag?: string
  detailFields?: Record<string, unknown>
}

export interface TimelineEventView {
  eventType: string
  payload: Record<string, unknown> | null
  createdAt: string
}

/** Offer as the report OWNER sees it (decisions 6/40/41/60): identity
 *  only when the helper chose it AND the tier is not high; timestamps
 *  never on high tier. Shape owned here — no cross-module type import. */
export interface OfferView {
  helpOfferId: number
  helpType: string
  helperDisplayName: string | null
  createdAt: string | null
}

/** Attachment as owner/participant see it (M2). The public open view
 *  carries publicIds only — which derivative a third party may fetch is
 *  the media route's decision (blur-only on high tier, decision 128). */
export interface MediaAttachmentView {
  publicId: string
  mime?: string
  width?: number
  height?: number
}

/** GetReportVisibility output (decisions 24/41/50/128/135). */
export type ReportView =
  | {
      access: 'summary'
      reportId: number
      category: Category | null
      freeTag: string | null
      subject: Subject
      status: 'resolved'
      tier: string
      resolvedAt: string
    }
  | {
      access: 'public'
      reportId: number
      category: Category | null
      freeTag: string | null
      subject: Subject
      status: 'open'
      tier: string
      position: { lat: number; lng: number }
      detailFields: Record<string, unknown> | null
      createdAt: string
      media: MediaAttachmentView[]
    }
  | {
      access: 'participant' | 'owner'
      reportId: number
      category: Category | null
      freeTag: string | null
      subject: Subject
      status: ReportStatus
      tier: string
      position: { lat: number; lng: number }
      detailFields: Record<string, unknown> | null
      createdAt: string
      resolvedAt: string | null
      timeline: TimelineEventView[]
      media: MediaAttachmentView[]
      /** Owner only — absent for participants (decision 55's caution). */
      offers?: OfferView[]
    }

/** Panel screen state (decisions 141/142). */
export interface CaseFreezeState {
  reportId: number
  status: ReportStatus
  frozen: boolean
  frozenReason: string | null
  frozenAt: string | null
  pendingUnfreeze: { reason: string; requestedBy: number; requestedAt: string } | null
}
