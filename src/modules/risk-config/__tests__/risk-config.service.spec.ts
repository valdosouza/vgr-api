import pool from '@shared/db/connection'
import * as repository from '@modules/risk-config/risk-config.repository'
import { getRiskTier, setRiskTier } from '@modules/risk-config/risk-config.service'
import { invalidateRiskTierCache } from '@shared/risk/risk-tier'

jest.mock('@modules/risk-config/risk-config.repository')
// The READ path moved to @shared/risk/risk-tier (decision 135 consumer)
// and queries the pool directly — the module repository now only backs
// the admin CRUD, so reads are mocked at the pool.
jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedQuery = pool.query as jest.Mock

describe('risk-config.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    invalidateRiskTierCache()
  })

  it('returns the configured tier, not a default, for a Category that was explicitly set', async () => {
    mockedQuery.mockResolvedValue([[{ tier: 'high' }]])

    const tier = await getRiskTier('trafficking')

    expect(tier).toBe('high')
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('tb_risk_tier_config'), [
      'trafficking',
    ])
  })

  it('defaults to low for a Category with no configured RiskTier', async () => {
    mockedQuery.mockResolvedValue([[]])

    const tier = await getRiskTier('traffic')

    expect(tier).toBe('low')
  })

  it('is readable from cache without a query on every request (TTL-cached)', async () => {
    mockedQuery.mockResolvedValue([[{ tier: 'medium' }]])

    await getRiskTier('assault')
    await getRiskTier('assault')

    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('persists an admin update and invalidates the cache so the next read reflects it', async () => {
    mockedQuery.mockResolvedValueOnce([[{ tier: 'low' }]])
    await getRiskTier('robbery')

    await setRiskTier('robbery', 'high')
    expect(mockedRepository.upsertRiskTierConfig).toHaveBeenCalledWith('robbery', 'high')

    mockedQuery.mockResolvedValueOnce([[{ tier: 'high' }]])
    const tier = await getRiskTier('robbery')

    expect(tier).toBe('high')
    expect(mockedQuery).toHaveBeenCalledTimes(2)
  })
})
