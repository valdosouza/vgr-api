import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Envelope encryption for at-risk identifiable data (decisions 44/111).
 *
 * Each record gets its own random data key (DEK); the payload carries the
 * DEK wrapped by the master key (KEK), which lives ONLY in the
 * environment (LEGAL_KEK — secret manager in deployment, §6 of the
 * security plan). Properties this buys:
 *  - a leaked database alone is binary garbage (decision 44's exact bar);
 *  - one compromised DEK exposes ONE record;
 *  - KEK rotation re-wraps DEKs (small columns), never the data — each
 *    payload records the KEK version that wrapped it;
 *  - GCM authenticates: a tampered record fails to decrypt, which matters
 *    in a log that exists to hold people accountable (decision 23).
 *
 * Payload format (all base64url, dot-separated):
 *   v1.k<kekVersion>.<iv_dek>.<tag_dek>.<wrapped_dek>.<iv_data>.<tag_data>.<ciphertext>
 */

const PREFIX = 'v1'

function kek(): { key: Buffer; version: number } {
  const raw = process.env.LEGAL_KEK
  if (!raw) {
    throw new Error('LEGAL_KEK is not configured')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('LEGAL_KEK must be 32 bytes, base64-encoded')
  }
  const version = Number(process.env.LEGAL_KEK_VERSION ?? '1')
  return { key, version: Number.isFinite(version) ? version : 1 }
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function aesEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; tag: Buffer; data: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { iv, tag: cipher.getAuthTag(), data }
}

function aesDecrypt(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

export function encryptEnvelope(plaintext: string): string {
  const master = kek()
  const dek = randomBytes(32)
  const wrapped = aesEncrypt(master.key, dek)
  const sealed = aesEncrypt(dek, Buffer.from(plaintext, 'utf8'))
  return [
    PREFIX,
    `k${master.version}`,
    b64(wrapped.iv),
    b64(wrapped.tag),
    b64(wrapped.data),
    b64(sealed.iv),
    b64(sealed.tag),
    b64(sealed.data),
  ].join('.')
}

export function decryptEnvelope(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 8 || parts[0] !== PREFIX) {
    throw new Error('Not an envelope payload')
  }
  const master = kek()
  const [, , ivDek, tagDek, wrappedDek, ivData, tagData, ciphertext] = parts
  const dek = aesDecrypt(
    master.key,
    Buffer.from(ivDek, 'base64url'),
    Buffer.from(tagDek, 'base64url'),
    Buffer.from(wrappedDek, 'base64url')
  )
  return aesDecrypt(
    dek,
    Buffer.from(ivData, 'base64url'),
    Buffer.from(tagData, 'base64url'),
    Buffer.from(ciphertext, 'base64url')
  ).toString('utf8')
}

export function isEnvelope(value: string): boolean {
  return value.startsWith(`${PREFIX}.k`)
}
