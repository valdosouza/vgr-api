export type MediaClass = 'evidence' | 'avatar'

export type MediaStatus = 'pending' | 'available' | 'blocked' | 'deleted'

/** Objects stored per media (plano-imagens.md §4). Everything the app ever
 *  receives is re-encoded output — 'original' exists only when the
 *  reporter chose to keep probative data (decision 130) and is read
 *  exclusively by the audited panel flow (not built in M1). */
export type MediaVariant = 'normalized' | 'thumb' | 'blur' | 'original'

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
