import pool from '@shared/db/connection'
import { appendAccountabilityLogEntry } from '@modules/identity/accountability-log.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

describe('accountability-log.repository', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('appends an entry capturing the action type, IP, and metadata for an anonymous actor', async () => {
    mockedPool.query.mockResolvedValue([{}, undefined] as any)

    await appendAccountabilityLogEntry('report_submitted', '203.0.113.7', { reportId: 1 })

    expect(mockedPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tb_accountability_log'),
      ['report_submitted', '203.0.113.7', JSON.stringify({ reportId: 1 })]
    )
  })

  it('accepts a null metadata payload', async () => {
    mockedPool.query.mockResolvedValue([{}, undefined] as any)

    await appendAccountabilityLogEntry('help_offer_submitted', '203.0.113.8', null)

    expect(mockedPool.query).toHaveBeenCalledWith(expect.any(String), ['help_offer_submitted', '203.0.113.8', null])
  })
})
