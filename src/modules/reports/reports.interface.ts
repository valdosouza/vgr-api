/** Taxonomy moved to @shared/taxonomy/taxonomy when help-matching became
 *  the second consumer (amendment E8 pattern) — re-exported here to keep
 *  the module surface stable. */
export { CATEGORIES, SUBJECTS } from '@shared/taxonomy/taxonomy'
export type { Category, Subject } from '@shared/taxonomy/taxonomy'
import type { Category, Subject } from '@shared/taxonomy/taxonomy'
import type { RiskTier } from '@shared/risk/risk-tier'
import type { ModerationReason } from '@shared/moderation/moderation-reason'
import type { StatCount } from '@shared/stats/k-anonymity'

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
  /** Moderation (B2, decision 162) — orthogonal to status/frozen/retention. */
  hidden: boolean
  hiddenReasonCode: ModerationReason | null
  hiddenNote: string | null
  hiddenAt: Date | null
  hiddenBy: number | null
  /** Review mark (B3, decision 161) — "eyes were on it"; not a moderation
   *  act, orthogonal to hidden/frozen/retention. */
  reviewedAt: Date | null
  reviewedBy: number | null
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
  /** Rating facet (RT1, decisions 48/180/181/183) — owner only (185). */
  rating: OfferRatingView
}

/** What the OWNER sees of an offer's rating: the score they gave (null
 *  until rated) and whether they can rate it NOW — the case is resolved
 *  (181) and not hidden (162), the helper holds an account (180) and no
 *  rating exists yet (183). Shape owned here — no cross-module import;
 *  the rating itself is written through /app-reports/:id/offers/:offerId/
 *  rating (modules/ratings). Participants never carry it (185). */
export interface OfferRatingView {
  score: number | null
  ratable: boolean
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
      /** Decision 167: the mark only — the reason belongs to the audit
       *  trail, never to the reporter (nor to a participant). */
      hidden: boolean
      timeline: TimelineEventView[]
      media: MediaAttachmentView[]
      /** Owner only — absent for participants (decision 55's caution). */
      offers?: OfferView[]
      /** Chat entry point (C1, decision 172): counts only — the owner
       *  sees how many threads/unread, a helper participant their own
       *  thread id (null before the first message) and unread. Never on
       *  the public/summary views. */
      chat: OwnerChatSummary | HelperChatSummary
    }

export interface OwnerChatSummary {
  threads: number
  unread: number
}

export interface HelperChatSummary {
  threadId: number | null
  unread: number
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

/* ------------------------------------------------------------------ *
 * Panel plane — B1 of plano-moderacao-painel.md (decisions 159/160/166).
 * ------------------------------------------------------------------ */

/** Filters the panel search resolves BEFORE the SQL (tier -> categories,
 *  date-only -> day bounds). The repository only knows columns. */
export interface ReportSearchFilters {
  id?: number
  status?: ReportStatus
  category?: Category
  subject?: Subject
  /** Tier filter resolved via shared/risk: the categories currently in
   *  the requested tier, plus free-tag rows when the null tier matches. */
  categories?: string[]
  includeFreeTag?: boolean
  frozen?: boolean
  hasMedia?: boolean
  hidden?: boolean
  /** reviewed_at IS NOT NULL / IS NULL (B3, decision 161). */
  reviewed?: boolean
  createdFrom?: Date
  createdTo?: Date
  /** True when `to` was date-only: bound = next midnight, compared with `<`. */
  createdToExclusive?: boolean
}

/** Narrow projection for the list: NO clientKey, NO reporterAccountId —
 *  the search never needs identity, so it never loads it (decision 160). */
export interface ReportSearchRow {
  id: number
  category: Category | null
  freeTag: string | null
  subject: Subject
  anonymous: boolean
  status: ReportStatus
  frozen: boolean
  purged: boolean
  hidden: boolean
  reviewed: boolean
  lat: number | null
  lng: number | null
  mediaCount: number
  createdAt: Date
  resolvedAt: Date | null
}

export interface ReportListItem {
  reportId: number
  category: Category | null
  freeTag: string | null
  subject: Subject
  tier: RiskTier
  status: ReportStatus
  anonymous: boolean
  frozen: boolean
  purged: boolean
  /** Moderation mark (B2, decision 162). */
  hidden: boolean
  /** Review mark (B3, decision 161). */
  reviewed: boolean
  mediaCount: number
  /** DEGRADED grid (decision 135); null when purged. */
  position: { lat: number; lng: number } | null
  createdAt: string
  resolvedAt: string | null
}

export interface ReportPage {
  items: ReportListItem[]
  page: number
  pageSize: number
  total: number
}

/* ------------------------------------------------------------------ *
 * Proactive moderation queue — B3 of plano-moderacao-painel.md
 * (decision 161). The service resolves the tier -> category sets from
 * shared/risk; the repository only ranks column sets.
 * ------------------------------------------------------------------ */

export interface QueueTierSets {
  /** Every category, partitioned by the tier it currently sits in. */
  tierCategories: Record<RiskTier, string[]>
  /** Rank of free-tag rows (category IS NULL) = getRiskTier(null). */
  freeTagTier: RiskTier
}

/** The B1 list item (degraded position, no identity) plus queue fields. */
export type QueueItem = ReportListItem & {
  priority: RiskTier
  hasMedia: boolean
  /** Whole hours since created_at at serving time. */
  ageHours: number
}

export interface QueuePage {
  items: QueueItem[]
  page: number
  pageSize: number
  total: number
}

/** The only identity shape the panel ever sees (decision 160). */
export interface PanelActorRef {
  accountId: number
  displayName: string
}

export interface PanelMediaView {
  publicId: string
  mime: string
  width: number
  height: number
  /** tb_media.status — the panel sees blocked/pending too (M3). */
  status: string
  /** Block reason (B2, decision 162) — null unless status is 'blocked'. */
  blockedReasonCode: ModerationReason | null
  blockedNote: string | null
  blockedAt: string | null
}

export interface PanelOfferView {
  helpOfferId: number
  helpType: string
  anonymous: boolean
  helper: PanelActorRef | null
  createdAt: string
  /** Rating facet (RT3, decision 186) — the score only; the panel never
   *  rates, so no `ratable` flag and no rater identity (there is none to
   *  leak — clientKey lives on the app plane's write path, RT1). */
  ratingScore: number | null
}

export interface ReportPanelDetail {
  reportId: number
  category: Category | null
  freeTag: string | null
  subject: Subject
  tier: RiskTier
  status: ReportStatus
  anonymous: boolean
  frozen: boolean
  frozenReason: string | null
  frozenAt: string | null
  purged: boolean
  /** Moderation (B2, decision 162): the panel sees the reason — the
   *  reporter never does (167). */
  hidden: boolean
  hiddenReasonCode: ModerationReason | null
  hiddenNote: string | null
  hiddenAt: string | null
  hiddenBy: number | null
  /** Review mark (B3, decision 161); also on the purged skeleton. */
  reviewedAt: string | null
  reviewedBy: number | null
  createdAt: string
  resolvedAt: string | null
  expiresAt: string | null
  /** null when anonymous (160). */
  reporter: PanelActorRef | null
  /** Degraded grid + its precision in metres (159); null when purged. */
  position: { lat: number; lng: number; precisionMeters: number } | null
  detailFields: Record<string, unknown> | null
  timeline: TimelineEventView[]
  media: PanelMediaView[]
  offers: PanelOfferView[]
}

export interface ReportExactPosition {
  reportId: number
  lat: number
  lng: number
}

/* ------------------------------------------------------------------ *
 * Statistics — B4 of plano-moderacao-painel.md (decisions 164/165).
 * Aggregates ONLY: no row id, no position, no identity ever appears in
 * these shapes; every count is a StatCount (number | "<5", the k = 5
 * floor of shared/stats/k-anonymity).
 * ------------------------------------------------------------------ */

export type StatsGranularity = 'day' | 'week' | 'month'

/** Resolved bounds over tb_report.created_at: `from` inclusive; `to`
 *  exclusive (date-only input -> next midnight UTC) or inclusive
 *  (date-time input / the `now` default) — the B1 search rules. */
export interface StatsRange {
  from: Date
  to: Date
  toExclusive: boolean
}

/** Raw (unfloored) totals as the repository counts them. */
export interface ReportStatsTotalsRow {
  reports: number
  open: number
  resolved: number
  anonymous: number
  identified: number
  frozen: number
  hidden: number
  /** status = 'resolved' AND expires_at reached — purged or not. */
  expired: number
  purged: number
  /** At least one living tb_media attached, any status (B1's hasMedia). */
  withMedia: number
}

export interface ReportStats {
  range: { from: string; to: string; granularity: StatsGranularity }
  totals: Record<keyof ReportStatsTotalsRow, StatCount>
  /** period key: 'YYYY-MM-DD' | 'YYYY-Www' (ISO week) | 'YYYY-MM'; ascending; empty periods omitted. */
  byPeriod: Array<{ period: string; reports: StatCount }>
  /** category null = free-tag reports (tier = getRiskTier(null)). */
  byCategory: Array<{ category: Category | null; tier: RiskTier; reports: StatCount }>
  bySubject: Array<{ subject: Subject; reports: StatCount }>
  byStatus: Array<{ status: ReportStatus; reports: StatCount }>
  /** Summed from byCategory BEFORE flooring (164). */
  byTier: Array<{ tier: RiskTier; reports: StatCount }>
  moderation: {
    /** Reports created in range that are currently hidden, by hidden_reason_code. */
    hiddenByReason: Array<{ reasonCode: ModerationReason; reports: StatCount }>
    /** Blocked media attached to reports created in range, by blocked_reason_code. */
    blockedMediaByReason: Array<{ reasonCode: ModerationReason; media: StatCount }>
  }
}
