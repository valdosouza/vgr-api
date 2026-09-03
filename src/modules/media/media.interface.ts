/** Variant type promoted to @shared/storage/media-object when reports
 *  became the second reader (M2, amendment-E8 pattern) — re-exported here
 *  to keep the module surface stable. */
export type { MediaVariant } from '@shared/storage/media-object'
import type { ModerationReason } from '@shared/moderation/moderation-reason'

export type MediaClass = 'evidence' | 'avatar'

/** 'pending' = uploaded, not yet attached to a report; the attach consumes
 *  it (decision 134) and 'available' means attached from M2 on. Pending
 *  media never attached expires as an orphan (decision 136). */
export type MediaStatus = 'pending' | 'available' | 'blocked' | 'deleted'

export interface MediaRow {
  id: number
  publicId: string
  class: MediaClass
  uploaderAccountId: number | null
  status: MediaStatus
  mimeOriginal: string
  mime: string
  bytesOriginal: number
  bytes: number
  width: number
  height: number
  sha256Original: string
  sha256: string
  storagePrefix: string
  keepOriginal: boolean
  exifWarningVersion: string | null
  dekWrapped: string | null
  expiresAt: Date | null
  frozen: boolean
  /** Moderation hold (B2, decision 162) — set while status is 'blocked'.
   *  Orthogonal to frozen (141b) and to the retention clock (131). */
  blockedReasonCode: ModerationReason | null
  blockedNote: string | null
  blockedAt: Date | null
  blockedBy: number | null
}

/** What the panel gets back from block/unblock (B2). */
export interface MediaModerationState {
  publicId: string
  status: MediaStatus
  blockedReasonCode: ModerationReason | null
  blockedNote: string | null
  blockedAt: string | null
}

export interface IngestInput {
  data: Buffer
  class: MediaClass
  uploaderAccountId: number | null
  /** Decision 130 — per-photo choice, default discard. */
  keepOriginal: boolean
  /** Version of the warning text shown when keepOriginal is true
   *  (pattern of decision 86). */
  exifWarningVersion: string | null
}

export interface IngestResult {
  publicId: string
  mime: string
  bytes: number
  width: number
  height: number
}
