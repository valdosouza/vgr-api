import * as repository from '@modules/media/media.repository'
import { MediaVariant } from '@modules/media/media.interface'
import { blobStore } from '@shared/storage/blob-store'
import logger from '@shared/logger/logger'

/**
 * Retention job (decision 131, plano-imagens.md §7). Order matters:
 * shredding the DEK comes FIRST — that is the security boundary (the
 * objects are unrecoverable from that point, backups included); deleting
 * the storage objects afterwards is cost hygiene and may fail without
 * weakening anything, so failures are logged and never retried here (the
 * object is ciphertext with no key in existence).
 *
 * `expires_at` is stamped when the owning case resolves (M2); frozen rows
 * (case in an authority's hands) are never selected.
 */
const BATCH = 100

export async function runMediaExpiry(): Promise<{ shredded: number }> {
  let shredded = 0

  for (;;) {
    const due = await repository.findExpired(BATCH)
    if (due.length === 0) break

    for (const media of due) {
      await repository.shred(media.id)
      shredded += 1

      const variants: MediaVariant[] = ['normalized', 'thumb', 'blur']
      if (media.keepOriginal) variants.push('original')
      const prefix = `${media.storagePrefix.slice(0, 2)}/${media.storagePrefix}`
      for (const variant of variants) {
        try {
          await blobStore().delete(`${prefix}/${variant}`)
        } catch (err) {
          logger.error('Expired media object delete failed (already shredded)', {
            err,
            mediaId: media.id,
            variant,
          })
        }
      }
    }

    if (due.length < BATCH) break
  }

  if (shredded > 0) {
    logger.info(`Media expiry: crypto-shredded ${shredded} media`)
  }
  return { shredded }
}
