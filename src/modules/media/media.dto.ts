import { z } from 'zod'

/**
 * Multipart text fields accompanying the file. Multipart fields are always
 * strings — booleans arrive as 'true'/'false'.
 */
export const uploadMediaDto = z.object({
  class: z.enum(['evidence', 'avatar']).default('evidence'),
  /** Decision 130 — per-photo choice, default discard. */
  keepOriginal: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Required by the service when keepOriginal is true (decision 86 pattern). */
  exifWarningVersion: z.string().min(1).max(20).optional(),
})

export const mediaVariantDto = z.enum(['normalized', 'thumb', 'blur', 'original'])
