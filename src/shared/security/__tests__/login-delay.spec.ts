import { computeLoginDelayMs } from '@shared/security/login-delay'

describe('login-delay (decision 113)', () => {
  it('gives 5 free attempts — no delay while a human mistypes', () => {
    expect(computeLoginDelayMs(0)).toBe(0)
    expect(computeLoginDelayMs(4)).toBe(0)
  })

  it('grows exponentially from the 5th failure on', () => {
    expect(computeLoginDelayMs(5)).toBe(1_000)
    expect(computeLoginDelayMs(6)).toBe(2_000)
    expect(computeLoginDelayMs(7)).toBe(4_000)
    expect(computeLoginDelayMs(9)).toBe(16_000)
  })

  it('caps at 30s — slows machines without ever hard-locking a human (no DoS via failed logins)', () => {
    expect(computeLoginDelayMs(10)).toBe(30_000)
    expect(computeLoginDelayMs(50)).toBe(30_000)
  })
})
