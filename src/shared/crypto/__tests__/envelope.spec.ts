import { randomBytes } from 'crypto'
import { decryptEnvelope, encryptEnvelope, isEnvelope } from '@shared/crypto/envelope'

describe('envelope encryption (decisions 44/111)', () => {
  beforeEach(() => {
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
    process.env.LEGAL_KEK_VERSION = '1'
  })

  afterAll(() => {
    delete process.env.LEGAL_KEK
    delete process.env.LEGAL_KEK_VERSION
  })

  it('round-trips utf8 content', () => {
    const payload = encryptEnvelope('189.45.200.13')
    expect(decryptEnvelope(payload)).toBe('189.45.200.13')
  })

  it('never repeats ciphertext — a fresh DEK per record (firewall per row)', () => {
    const first = encryptEnvelope('same-plaintext')
    const second = encryptEnvelope('same-plaintext')
    expect(first).not.toBe(second)
  })

  it('stamps the payload with prefix and KEK version for rotation', () => {
    process.env.LEGAL_KEK_VERSION = '3'
    const payload = encryptEnvelope('x')
    expect(payload.startsWith('v1.k3.')).toBe(true)
    expect(isEnvelope(payload)).toBe(true)
    expect(isEnvelope('189.45.200.13')).toBe(false)
  })

  it('fails on tampered ciphertext — GCM integrity (decision 23 needs an honest log)', () => {
    const payload = encryptEnvelope('legit')
    const parts = payload.split('.')
    const corrupted = Buffer.from(parts[7], 'base64url')
    corrupted[0] ^= 0xff
    parts[7] = corrupted.toString('base64url')
    expect(() => decryptEnvelope(parts.join('.'))).toThrow()
  })

  it('fails under a different KEK — the database alone is garbage (decision 44)', () => {
    const payload = encryptEnvelope('secret')
    process.env.LEGAL_KEK = randomBytes(32).toString('base64')
    expect(() => decryptEnvelope(payload)).toThrow()
  })

  it('refuses to operate without a KEK, and rejects a short one', () => {
    delete process.env.LEGAL_KEK
    expect(() => encryptEnvelope('x')).toThrow('LEGAL_KEK is not configured')
    process.env.LEGAL_KEK = randomBytes(16).toString('base64')
    expect(() => encryptEnvelope('x')).toThrow('32 bytes')
  })
})
