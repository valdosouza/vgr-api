import { randomBytes } from 'crypto'
import { aesDecrypt, aesEncrypt } from '@shared/crypto/envelope'

/**
 * Envelope encryption for media objects (decision 126 / plano-imagens.md
 * §4-5). Same DEK/KEK mechanics as envelope.ts (decision 111) with two
 * deliberate differences:
 *
 *  - the KEK is MEDIA_KEK, SEPARATE from LEGAL_KEK: compromising one class
 *    of data never opens the other;
 *  - the payload is split: the wrapped DEK is a small string kept in
 *    tb_media.dek_wrapped (so crypto-shredding = clearing one column,
 *    decision 131), while the object in storage is raw binary
 *    iv(12) || tag(16) || ciphertext — a leaked bucket is noise.
 *
 * One DEK per media; each variant (normalized/thumb/blur/original) is
 * sealed with the same DEK and a fresh IV, which AES-GCM permits.
 */

const PREFIX = 'v1'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function kek(): { key: Buffer; version: number } {
  const raw = process.env.MEDIA_KEK
  if (!raw) {
    throw new Error('MEDIA_KEK is not configured')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('MEDIA_KEK must be 32 bytes, base64-encoded')
  }
  const version = Number(process.env.MEDIA_KEK_VERSION ?? '1')
  return { key, version: Number.isFinite(version) ? version : 1 }
}

export function generateDek(): Buffer {
  return randomBytes(32)
}

/** v1.k<kekVersion>.<iv>.<tag>.<wrapped> — stored in tb_media.dek_wrapped. */
export function wrapDek(dek: Buffer): string {
  const master = kek()
  const wrapped = aesEncrypt(master.key, dek)
  return [
    PREFIX,
    `k${master.version}`,
    wrapped.iv.toString('base64url'),
    wrapped.tag.toString('base64url'),
    wrapped.data.toString('base64url'),
  ].join('.')
}

export function unwrapDek(payload: string): Buffer {
  const parts = payload.split('.')
  if (parts.length !== 5 || parts[0] !== PREFIX) {
    throw new Error('Not a wrapped media DEK')
  }
  const master = kek()
  const [, , iv, tag, wrapped] = parts
  return aesDecrypt(
    master.key,
    Buffer.from(iv, 'base64url'),
    Buffer.from(tag, 'base64url'),
    Buffer.from(wrapped, 'base64url')
  )
}

/** iv(12) || tag(16) || ciphertext — the object body sent to the BlobStore. */
export function sealBlob(dek: Buffer, plaintext: Buffer): Buffer {
  const sealed = aesEncrypt(dek, plaintext)
  return Buffer.concat([sealed.iv, sealed.tag, sealed.data])
}

export function openBlob(dek: Buffer, blob: Buffer): Buffer {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Sealed blob too short')
  }
  const iv = blob.subarray(0, IV_LENGTH)
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const data = blob.subarray(IV_LENGTH + TAG_LENGTH)
  return aesDecrypt(dek, iv, tag, data)
}
