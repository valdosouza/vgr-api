import * as repository from '@modules/risk-config/risk-config.repository'
import { getRiskTier, setRiskTier } from '@modules/risk-config/risk-config.service'

jest.mock('@modules/risk-config/risk-config.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('risk-config.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns the configured tier, not a default, for a Category that was explicitly set', async () => {
    mockedRepository.findRiskTierConfigByCategory.mockResolvedValue({ category: 'trafficking', tier: 'high' })

    const tier = await getRiskTier('trafficking')

    expect(tier).toBe('high')
    expect(mockedRepository.findRiskTierConfigByCategory).toHaveBeenCalledWith('trafficking')
  })

  it('defaults to low for a Category with no configured RiskTier', async () => {
    mockedRepository.findRiskTierConfigByCategory.mockResolvedValue(null)

    const tier = await getRiskTier('traffic')

    expect(tier).toBe('low')
  })

  it('is readable from cache without a query on every request (TTL-cached)', async () => {
    mockedRepository.findRiskTierConfigByCategory.mockResolvedValue({ category: 'assault', tier: 'medium' })

    await getRiskTier('assault')
    await getRiskTier('assault')

    expect(mockedRepository.findRiskTierConfigByCategory).toHaveBeenCalledTimes(1)
  })

  it('persists an admin update and invalidates the cache so the next read reflects it', async () => {
    mockedRepository.findRiskTierConfigByCategory.mockResolvedValueOnce({ category: 'robbery', tier: 'low' })
    await getRiskTier('robbery')

    await setRiskTier('robbery', 'high')
    expect(mockedRepository.upsertRiskTierConfig).toHaveBeenCalledWith('robbery', 'high')

    mockedRepository.findRiskTierConfigByCategory.mockResolvedValueOnce({ category: 'robbery', tier: 'high' })
    const tier = await getRiskTier('robbery')

    expect(tier).toBe('high')
    expect(mockedRepository.findRiskTierConfigByCategory).toHaveBeenCalledTimes(2)
  })
})
