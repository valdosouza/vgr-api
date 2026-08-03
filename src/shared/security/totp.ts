import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * TOTP — RFC 6238 over HMAC-SHA1, 6 digits, 30s step (decision 114).
 * Implemented on node's crypto directly: ~40 lines beat a dependency in
 * the auth path (decision 118's hygiene cuts both ways). SMS is banned by
 * the decision (SIM swap); this pairs with any standard authenticator.
 */

const STEP_SECONDS = 30
const DIGITS = 6

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Accepts the current step and its immediate neighbors (clock skew). */
export function verifyTotp(secret: string, code: string, at: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const counter = Math.floor(at / 1000 / STEP_SECONDS)
  const expected = Buffer.from(code)
  for (const step of [counter, counter - 1, counter + 1]) {
    const candidate = Buffer.from(hotp(secret, step))
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true
    }
  }
  return false
}

/** Current code for a secret — used by specs and by nothing user-facing. */
export function currentTotp(secret: string, at: number = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP_SECONDS))
}

/** otpauth:// URI the panel renders as a QR code at enrollment. */
export function totpUri(secret: string, accountEmail: string): string {
  const issuer = encodeURIComponent('VGR Admin')
  return `otpauth://totp/${issuer}:${encodeURIComponent(accountEmail)}?secret=${secret}&issuer=${issuer}&digits=${DIGITS}&period=${STEP_SECONDS}`
}
