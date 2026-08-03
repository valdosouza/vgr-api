import * as repository from '@modules/risk-config/risk-config.repository'
import { listRiskTierConfigs } from '@modules/risk-config/risk-config.service'

jest.mock('@modules/risk-config/risk-config.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('risk-config.service — listRiskTierConfigs', () => {
  it('returns every configured RiskTierConfig row', async () => {
    mockedRepository.findAllRiskTierConfigs.mockResolvedValue([
      { category: 'trafficking', tier: 'high' },
      { category: 'traffic', tier: 'low' },
    ])

    const rows = await listRiskTierConfigs()

    expect(rows).toEqual([
      { category: 'trafficking', tier: 'high' },
      { category: 'traffic', tier: 'low' },
    ])
  })
})
