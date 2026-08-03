import { isAcceptablePassword, newPasswordSchema } from '@shared/security/password-policy'

describe('password-policy (decision 114)', () => {
  it('rejects anything under 12 characters — the old min(5) is gone', () => {
    expect(newPasswordSchema.safeParse('curta').success).toBe(false)
    expect(newPasswordSchema.safeParse('onzecharsxx').success).toBe(false)
  })

  it('accepts a normal 12+ passphrase without composition rules', () => {
    expect(newPasswordSchema.safeParse('cavalo pasto verde 7').success).toBe(true)
    expect(newPasswordSchema.safeParse('minhasenhagigantesegura').success).toBe(true)
  })

  it('rejects the common >=12 stragglers regardless of case', () => {
    expect(newPasswordSchema.safeParse('123456789012').success).toBe(false)
    expect(newPasswordSchema.safeParse('Password1234').success).toBe(false)
    expect(newPasswordSchema.safeParse('ADMINISTRATOR').success).toBe(false)
  })

  it('rejects trivial sequences and repeated blocks', () => {
    expect(isAcceptablePassword('aaaaaaaaaaaa')).toBe(false)
    expect(isAcceptablePassword('abcdefghijkl')).toBe(false)
    expect(isAcceptablePassword('zyxwvutsrqpo')).toBe(false)
    expect(isAcceptablePassword('abcabcabcabc')).toBe(false)
    expect(isAcceptablePassword('121212121212')).toBe(false)
  })

  it('caps at 72 (bcrypt input limit)', () => {
    expect(newPasswordSchema.safeParse('x'.repeat(73)).success).toBe(false)
  })
})
