import pool from '@shared/db/connection'
import * as repository from '@modules/help-matching/help-matching.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

describe('help-matching.repository — feed SQL', () => {
  beforeEach(() => jest.resetAllMocks())

  it('listNearby serves only open, living, NOT hidden reports (decision 162)', async () => {
    mockedPool.query.mockResolvedValue([[], undefined] as any)

    await repository.listNearby({ lat: -23.55, lng: -46.63 }, 'recency', 0, 21)

    const [sql] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain("r.deleted = 'N'")
    expect(flat).toContain("r.status = 'open'")
    expect(flat).toContain("r.hidden = 'N'")
  })
})
