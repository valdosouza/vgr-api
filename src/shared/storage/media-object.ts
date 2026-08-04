import { blobStore } from '@shared/storage/blob-store'
import { openBlob, unwrapDek } from '@shared/crypto/media-cipher'

/** Objects stored per media (plano-imagens.md §4). Everything the app ever
 *  receives is re-encoded output — 'original' exists only when the
 *  reporter chose to keep probative data (decision 130) and is read
 *  exclusively by the audited panel flow. Promoted from the media module
 *  when reports became the second reader (M2, amendment-E8 pattern). */
export type MediaVariant = 'normalized' | 'thumb' | 'blur' | 'original'

/** Key layout (plano-imagens.md §3, rule 3): <2-char shard>/<prefix>/
 *  <variant> — never contains user, report or date. */
export function mediaObjectKey(storagePrefix: string, variant: MediaVariant): string {
  return `${storagePrefix.slice(0, 2)}/${storagePrefix}/${variant}`
}

/** Fetches and decrypts one stored variant; null when the object is gone
 *  (shredded storage is expected — the DEK is the security boundary). */
export async function openMediaObject(
  storagePrefix: string,
  dekWrapped: string,
  variant: MediaVariant
): Promise<Buffer | null> {
  const blob = await blobStore().get(mediaObjectKey(storagePrefix, variant))
  if (!blob) return null
  return openBlob(unwrapDek(dekWrapped), blob)
}
