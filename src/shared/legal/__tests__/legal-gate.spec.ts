import * as repository from '@shared/legal/legal-gate.repository'
import {
  assertCapability,
  checkCapability,
  invalidateLegalGateCache,
} from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ActiveRuleRow, JurisdictionRow } from '@shared/legal/legal-gate.interface'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@shared/legal/legal-gate.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

function jurisdiction(overrides: Partial<JurisdictionRow> = {}): JurisdictionRow {
  return {
    code: 'BR',
    name: 'Brazil',
    operationalState: 'live',
    isSandbox: false,
    pendingState: null,
    pendingBy: null,
    ...overrides,
  }
}

function rule(overrides: Partial<ActiveRuleRow> = {}): ActiveRuleRow {
  return {
    id: 1,
    capability: Capabilities.REPORT_ANONYMOUS,
    jurisdictionCode: 'BR',
    version: 1,
    status: 'allowed',
    reason: null,
    reviewState: 'ai_assessed',
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  }
}

describe('legal-gate', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    invalidateLegalGateCache()
    process.env.LEGAL_JURISDICTION = 'BR'
    mockedRepository.insertAudit.mockResolvedValue()
  })

  afterAll(() => {
    delete process.env.LEGAL_JURISDICTION
  })

  it('blocks an unknown capability everywhere — a typo never becomes an allow (decision 103)', async () => {
    process.env.LEGAL_JURISDICTION = 'SANDBOX'
    const decision = await checkCapability('reward.moentary')

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unknown_capability')
    // Catalog guard fires before any lookup.
    expect(mockedRepository.findJurisdiction).not.toHaveBeenCalled()
  })

  it('fails closed in a real jurisdiction when no rule exists (decision 104)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValue(null)

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unreviewed')
    expect(mockedRepository.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'blocked', reason: 'unreviewed' })
    )
  })

  it('inverts the default in SANDBOX and marks the response as demo (decision 79)', async () => {
    process.env.LEGAL_JURISDICTION = 'SANDBOX'
    mockedRepository.findJurisdiction.mockResolvedValue(
      jurisdiction({ code: 'SANDBOX', isSandbox: true })
    )
    mockedRepository.findActiveRule.mockResolvedValue(null)

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision).toMatchObject({ allowed: true, demo: true })
    expect(mockedRepository.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'demo' })
    )
  })

  it('lets an explicit blocked rule win even in SANDBOX', async () => {
    process.env.LEGAL_JURISDICTION = 'SANDBOX'
    mockedRepository.findJurisdiction.mockResolvedValue(
      jurisdiction({ code: 'SANDBOX', isSandbox: true })
    )
    mockedRepository.findActiveRule.mockResolvedValue(
      rule({ jurisdictionCode: 'SANDBOX', status: 'blocked', reason: 'self_preservation' })
    )

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('self_preservation')
  })

  it('treats an expired rule exactly like no rule (decision 108)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValue(
      rule({ expiresAt: new Date(Date.now() - 1_000) })
    )

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unreviewed')
  })

  it('allows under an active rule and carries the rule reference', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValue(rule({ id: 42, version: 3 }))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision).toMatchObject({ allowed: true, demo: false, rule: { id: 42, version: 3 } })
    // Plain allows under a rule are not audited (amendment — feature doc).
    expect(mockedRepository.insertAudit).not.toHaveBeenCalled()
  })

  it('suspends everything when the kill switch is on (decision 107)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(
      jurisdiction({ operationalState: 'suspended' })
    )

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('suspended')
    expect(mockedRepository.findActiveRule).not.toHaveBeenCalled()
  })

  it('under jurisdiction "restricted", only explicit allowed rules pass (plan §7)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(
      jurisdiction({ operationalState: 'restricted' })
    )
    mockedRepository.findActiveRule.mockResolvedValue(rule({ status: 'restricted' }))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('restricted')
  })

  it('treats a jurisdiction lookup failure as suspended — kill switch never degrades (decision 109)', async () => {
    mockedRepository.findJurisdiction.mockRejectedValue(new Error('db down'))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('suspended')
  })

  it('serves the last known rule during a bounded outage, then audits the degraded use (decision 109)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValueOnce(rule())

    // Prime the cache with a healthy read.
    await checkCapability(Capabilities.REPORT_ANONYMOUS)

    // TTL elapses; the next lookup hits a dead database.
    jest.useFakeTimers({ doNotFake: [] }).setSystemTime(Date.now() + 61_000)
    mockedRepository.findActiveRule.mockRejectedValue(new Error('db down'))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)
    jest.useRealTimers()

    expect(decision).toMatchObject({ allowed: true, degraded: true })
    expect(mockedRepository.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'degraded' })
    )
  })

  it('blocks with "unavailable" when the outage outlives the degraded window (decision 109)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValueOnce(rule())
    await checkCapability(Capabilities.REPORT_ANONYMOUS)

    jest.useFakeTimers({ doNotFake: [] }).setSystemTime(Date.now() + 16 * 60_000)
    mockedRepository.findActiveRule.mockRejectedValue(new Error('db down'))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)
    jest.useRealTimers()

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unavailable')
  })

  it('never serves a degraded answer for a key that was never cached (decision 109)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockRejectedValue(new Error('db down'))

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unavailable')
  })

  it('blocks reward.monetary when reward.mediation is not allowed (decision 98)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockImplementation(async (capability) =>
      capability === Capabilities.REWARD_MONETARY
        ? rule({ capability: Capabilities.REWARD_MONETARY })
        : null
    )

    const decision = await checkCapability(Capabilities.REWARD_MONETARY)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('dependency')
  })

  it('allows reward.monetary when reward.mediation is also allowed (decision 98)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockImplementation(async (capability) =>
      rule({ capability: capability as any })
    )

    const decision = await checkCapability(Capabilities.REWARD_MONETARY)

    expect(decision.allowed).toBe(true)
  })

  it('assertCapability throws HTTP 451 with the LEGAL_BLOCKED translation code (decision 80)', async () => {
    mockedRepository.findJurisdiction.mockResolvedValue(jurisdiction())
    mockedRepository.findActiveRule.mockResolvedValue(null)

    await expect(assertCapability(Capabilities.REPORT_ANONYMOUS)).rejects.toMatchObject({
      statusCode: 451,
      code: 'LEGAL_BLOCKED',
      params: { capability: 'report.anonymous', reason: 'unreviewed' },
    })
    await expect(assertCapability(Capabilities.REPORT_ANONYMOUS)).rejects.toBeInstanceOf(HttpError)
  })

  it('fails closed when LEGAL_JURISDICTION is unset in production', async () => {
    delete process.env.LEGAL_JURISDICTION
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    mockedRepository.findJurisdiction.mockResolvedValue(null)

    const decision = await checkCapability(Capabilities.REPORT_ANONYMOUS)
    process.env.NODE_ENV = previousNodeEnv

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('unknown_state')
    expect(mockedRepository.findJurisdiction).toHaveBeenCalledWith('UNCONFIGURED')
  })
})
