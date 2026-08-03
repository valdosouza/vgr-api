import { currentTotp, generateTotpSecret, totpUri, verifyTotp } from '@shared/security/totp'

describe('totp (RFC 6238 — decision 114)', () => {
  it('generates a base32 secret and verifies its current code', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(verifyTotp(secret, currentTotp(secret))).toBe(true)
  })

  it('matches RFC 6238 SHA-1 test vector (59s -> 94287082)', () => {
    // RFC secret "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(currentTotp(secret, 59_000).padStart(8, '0').slice(-6)).toBe('287082')
  })

  it('accepts one step of clock skew, rejects two', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    expect(verifyTotp(secret, currentTotp(secret, now - 30_000), now)).toBe(true)
    expect(verifyTotp(secret, currentTotp(secret, now + 30_000), now)).toBe(true)
    expect(verifyTotp(secret, currentTotp(secret, now - 90_000), now)).toBe(false)
  })

  it('rejects malformed codes outright', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '12345')).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
  })

  it('builds the otpauth URI the panel turns into a QR code', () => {
    const uri = totpUri('ABC234', 'valdo@vgr.com.br')
    expect(uri).toContain('otpauth://totp/')
    expect(uri).toContain('secret=ABC234')
    expect(uri).toContain('issuer=VGR%20Admin')
  })
})
