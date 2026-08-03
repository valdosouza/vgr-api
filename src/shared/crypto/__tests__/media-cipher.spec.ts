import { randomBytes } from 'crypto'
import {
  generateDek,
  openBlob,
  sealBlob,
  unwrapDek,
  wrapDek,
} from '@shared/crypto/media-cipher'

describe('media-cipher (decision 126 — envelope for media objects)', () => {
  beforeEach(() => {
    process.env.MEDIA_KEK = randomBytes(32).toString('base64')
    delete process.env.MEDIA_KEK_VERSION
  })

  it('wraps and unwraps a DEK', () => {
    const dek = generateDek()
    const wrapped = wrapDek(dek)
    expect(wrapped.startsWith('v1.k1.')).toBe(true)
    expect(unwrapDek(wrapped).equals(dek)).toBe(true)
  })

  it('records the KEK version that wrapped the DEK', () => {
    process.env.MEDIA_KEK_VERSION = '7'
    expect(wrapDek(generateDek()).startsWith('v1.k7.')).toBe(true)
  })

  it('seals and opens a binary blob', () => {
    const dek = generateDek()
    const plain = randomBytes(4096)
    const sealed = sealBlob(dek, plain)
    // iv(12) + tag(16) + ciphertext — and the ciphertext is not the plaintext.
    expect(sealed.length).toBe(plain.length + 28)
    expect(sealed.includes(plain.subarray(0, 64))).toBe(false)
    expect(openBlob(dek, sealed).equals(plain)).toBe(true)
  })

  it('rejects a tampered blob (GCM authentication)', () => {
    const dek = generateDek()
    const sealed = sealBlob(dek, Buffer.from('evidence'))
    sealed[sealed.length - 1] ^= 0xff
    expect(() => openBlob(dek, sealed)).toThrow()
  })

  it('rejects the wrong DEK', () => {
    const sealed = sealBlob(generateDek(), Buffer.from('evidence'))
    expect(() => openBlob(generateDek(), sealed)).toThrow()
  })

  it('a DEK wrapped under one KEK does not unwrap under another', () => {
    const wrapped = wrapDek(generateDek())
    process.env.MEDIA_KEK = randomBytes(32).toString('base64')
    expect(() => unwrapDek(wrapped)).toThrow()
  })

  it('fails loudly without MEDIA_KEK (no silent fallback)', () => {
    delete process.env.MEDIA_KEK
    expect(() => wrapDek(generateDek())).toThrow('MEDIA_KEK')
  })
})
