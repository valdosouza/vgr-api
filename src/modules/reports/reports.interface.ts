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
  lat: number
  lng: number
  anonymous: boolean
  reporterAccountId: number | null
  status: ReportStatus
  resolvedAt: Date | null
  expiresAt: Date | null
  frozen: boolean
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
