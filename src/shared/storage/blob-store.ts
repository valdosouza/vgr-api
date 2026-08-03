import { mediaConfig } from '@shared/config/env'
import { FsBlobStore } from '@shared/storage/fs-blob-store'
import { S3BlobStore } from '@shared/storage/s3-blob-store'

/**
 * The BlobStore port (decision 126, plano-imagens.md §3) — same pattern as
 * PaymentRail (decision 96): no storage concept (bucket, region,
 * presigned) ever leaks into entities/DTOs/tables. Swapping backends is a
 * config change plus an object copy, never a rewrite.
 *
 * Keys are internal (random prefix + variant, plan §3 rule 3) and objects
 * are ciphertext (media-cipher.ts) — the store never sees plaintext.
 */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>
  /** Resolves null when the object does not exist. */
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

let instance: BlobStore | null = null

/** Backend selected by BLOB_STORE (decision 126): 'fs' | 's3'. */
export function blobStore(): BlobStore {
  if (!instance) {
    const config = mediaConfig()
    instance = config.blobStore === 's3' ? new S3BlobStore(config.s3) : new FsBlobStore(config.fsRoot)
  }
  return instance
}

/** Tests swap backends via env — reset the memoized instance with it. */
export function resetBlobStoreForTests(): void {
  instance = null
}
