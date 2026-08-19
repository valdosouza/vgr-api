import * as repository from '@modules/monetization-config/fee-rule.repository'
import { getRiskTier } from '@shared/risk/risk-tier'
import { getFeeRule, setFeeRule, listFeeRules } from '@modules/monetization-config/fee-rule.service'

jest.mock('@modules/monetization-config/fee-rule.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGetRiskTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

describe('fee-rule.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedGetRiskTier.mockResolvedValue('low')
  })

  it('returns the Category-specific rule when one is explicitly set', async () => {
    mockedRepository.findFeeRuleByCategory.mockResolvedValueOnce({
      category: 'trafficking',
      feePercent: 5,
      paymentModeAllowed: ['intermediated'],
    })

    const rule = await getFeeRule('trafficking')

    expect(rule).toEqual({ category: 'trafficking', feePercent: 5, paymentModeAllowed: ['intermediated'] })
    expect(mockedRepository.findFeeRuleByCategory).toHaveBeenCalledWith('trafficking')
  })

  it('falls back to the global default rule when the Category has none of its own', async () => {
    mockedRepository.findFeeRuleByCategory.mockImplementation(async (category) => {
      if (category === null) return { category: null, feePercent: 10, paymentModeAllowed: ['intermediated', 'peer_to_peer'] }
      return null
    })

    const rule = await getFeeRule('traffic')

    expect(rule.feePercent).toBe(10)
    expect(mockedRepository.findFeeRuleByCategory).toHaveBeenCalledWith('traffic')
    expect(mockedRepository.findFeeRuleByCategory).toHaveBeenCalledWith(null)
  })

  it('falls back to the built-in default (no fee, both payment modes) when neither the Category nor the global rule is configured', async () => {
    mockedRepository.findFeeRuleByCategory.mockResolvedValue(null)

    const rule = await getFeeRule('vandalism')

    expect(rule).toEqual({ category: 'vandalism', feePercent: 0, paymentModeAllowed: ['intermediated', 'peer_to_peer'] })
  })

  it('is readable from cache without a query on every request (TTL-cached)', async () => {
    mockedRepository.findFeeRuleByCategory.mockResolvedValue({
      category: 'assault',
      feePercent: 3,
      paymentModeAllowed: ['intermediated'],
    })

    await getFeeRule('assault')
    await getFeeRule('assault')

    expect(mockedRepository.findFeeRuleByCategory).toHaveBeenCalledTimes(1)
  })

  it('persists an admin update and invalidates the cache so the next read reflects it', async () => {
    mockedRepository.findFeeRuleByCategory.mockResolvedValueOnce({
      category: 'robbery',
      feePercent: 0,
      paymentModeAllowed: ['intermediated', 'peer_to_peer'],
    })
    await getFeeRule('robbery')

    await setFeeRule('robbery', 8, ['intermediated'])
    expect(mockedRepository.upsertFeeRule).toHaveBeenCalledWith('robbery', 8, ['intermediated'])

    mockedRepository.findFeeRuleByCategory.mockResolvedValueOnce({
      category: 'robbery',
      feePercent: 8,
      paymentModeAllowed: ['intermediated'],
    })
    const rule = await getFeeRule('robbery')

    expect(rule.feePercent).toBe(8)
    expect(mockedRepository.findFeeRuleByCategory).toHaveBeenCalledTimes(2)
  })

  it('high tier: the EFFECTIVE rule never contains peer_to_peer, even from '
      + 'the global fallback (decisions 58/82)', async () => {
    mockedGetRiskTier.mockResolvedValue('high')
    mockedRepository.findFeeRuleByCategory.mockImplementation(async (category) => {
      if (category === null) {
        return { category: null, feePercent: 10, paymentModeAllowed: ['intermediated', 'peer_to_peer'] }
      }
      return null
    })

    const rule = await getFeeRule('kidnapping')

    expect(rule.paymentModeAllowed).toEqual(['intermediated'])
  })

  it('high tier: a tier RAISED after the rule was written strips peer_to_peer '
      + 'from the cached rule too (58)', async () => {
    mockedRepository.findFeeRuleByCategory.mockResolvedValue({
      category: 'suspicious',
      feePercent: 0,
      paymentModeAllowed: ['intermediated', 'peer_to_peer'],
    })

    expect((await getFeeRule('suspicious')).paymentModeAllowed).toContain('peer_to_peer')

    // The admin raises the tier; the fee cache still holds the raw rule —
    // the veto reads the CURRENT tier, not the cached moment's.
    mockedGetRiskTier.mockResolvedValue('high')
    expect((await getFeeRule('suspicious')).paymentModeAllowed).toEqual(['intermediated'])
  })

  it('rejects explicitly configuring peer_to_peer on a high-tier category '
      + '(58 — the admin sees the refusal, not a silent strip)', async () => {
    mockedGetRiskTier.mockResolvedValue('high')

    await expect(setFeeRule('assault', 5, ['intermediated', 'peer_to_peer']))
      .rejects.toMatchObject({ statusCode: 422 })
    expect(mockedRepository.upsertFeeRule).not.toHaveBeenCalled()
  })

  it('the GLOBAL rule may still allow peer_to_peer — low/medium categories '
      + 'use it; high ones are covered by the read-time veto', async () => {
    await setFeeRule(null, 10, ['intermediated', 'peer_to_peer'])

    expect(mockedRepository.upsertFeeRule)
      .toHaveBeenCalledWith(null, 10, ['intermediated', 'peer_to_peer'])
  })

  it('lists every configured rule as-is, with no fallback synthesis', async () => {
    mockedRepository.findAllFeeRules.mockResolvedValue([
      { category: null, feePercent: 10, paymentModeAllowed: ['intermediated', 'peer_to_peer'] },
      { category: 'trafficking', feePercent: 5, paymentModeAllowed: ['intermediated'] },
    ])

    const rules = await listFeeRules()

    expect(rules).toHaveLength(2)
    expect(mockedRepository.findAllFeeRules).toHaveBeenCalled()
  })
})
