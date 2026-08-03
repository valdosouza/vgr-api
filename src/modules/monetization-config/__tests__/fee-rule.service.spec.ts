import * as repository from '@modules/monetization-config/fee-rule.repository'
import { getFeeRule, setFeeRule, listFeeRules } from '@modules/monetization-config/fee-rule.service'

jest.mock('@modules/monetization-config/fee-rule.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('fee-rule.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
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
