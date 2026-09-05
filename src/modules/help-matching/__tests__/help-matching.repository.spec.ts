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

/** DS1 (decisions 200-207): the feed's batched facet — SQL over
 *  tb_direction_estimate (owned by direction-sightings) is table access,
 *  not a module import, same posture as listNearby's own tb_report query.
 *  ONE query for the whole page (IN (...)), keyed by reportId. */
describe('help-matching.repository — findDirectionEstimates (batched facet)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('returns an empty Map and never queries for an EMPTY id list', async () => {
    const result = await repository.findDirectionEstimates([])
    expect(result.size).toBe(0)
    expect(mockedPool.query).not.toHaveBeenCalled()
  })

  it('queries ONCE with an IN (...) over every id, groups rows per reportId, applies the floor + winning-direction pick per report', async () => {
    mockedPool.query.mockResolvedValue([
      [
        { reportId: 1, direction: 'N', totalWeight: '1.50', sightingCount: 3, firstReportedAt: new Date('2026-09-04T10:00:00Z') },
        { reportId: 1, direction: 'S', totalWeight: '2.00', sightingCount: 2, firstReportedAt: new Date('2026-09-04T11:00:00Z') },
        { reportId: 2, direction: 'E', totalWeight: '0.50', sightingCount: 1, firstReportedAt: new Date('2026-09-04T09:00:00Z') },
      ],
      undefined,
    ] as any)

    const result = await repository.findDirectionEstimates([1, 2, 3])

    expect(mockedPool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql.replace(/\s+/g, ' ')).toContain('FROM tb_direction_estimate')
    expect(params).toEqual([1, 2, 3])
    // Report 1: weighted winner is S (2.0 > 1.5) even though N has more
    // sightings — never a raw majority vote (decision 26).
    expect(result.get(1)).toEqual({ direction: 'S' })
    // Report 2: below the default floor (5) — absent/null.
    expect(result.get(2)).toBeNull()
    expect(result.has(3)).toBe(false)
  })
})
