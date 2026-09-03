import pool from '@shared/db/connection'
import * as repository from '@modules/reports/reports-stats.repository'
import { StatsRange } from '@modules/reports/reports.interface'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

const FROM = new Date('2026-08-01T00:00:00.000Z')
const TO = new Date('2026-09-01T00:00:00.000Z')
const exclusive: StatsRange = { from: FROM, to: TO, toExclusive: true }
const inclusive: StatsRange = { from: FROM, to: TO, toExclusive: false }

function lastQuery(): [string, unknown[]] {
  const calls = mockedPool.query.mock.calls
  const [sql, params] = calls[calls.length - 1] as unknown as [string, unknown[]]
  return [sql.replace(/\s+/g, ' '), params]
}

/** SQL contracts of the B4 aggregates (decision 164): GROUP BY over
 *  living rows in the created_at range, parameterized bounds, purged
 *  rows INCLUDED (the statistical skeleton of 25/131), never a row id. */
describe('reports-stats.repository — aggregate SQL (decision 164)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('countByPeriod', () => {
    it("day: DATE_FORMAT '%Y-%m-%d', living rows, bounds as params, ascending", async () => {
      mockedPool.query.mockResolvedValue([
        [
          { period: '2026-08-01', reports: '3' },
          { period: '2026-08-02', reports: 7 },
        ],
        undefined,
      ] as any)

      const rows = await repository.countByPeriod(exclusive, 'day')

      const [sql, params] = lastQuery()
      expect(sql).toContain("DATE_FORMAT(created_at, '%Y-%m-%d')")
      expect(sql).toContain('FROM tb_report')
      expect(sql).toContain("deleted = 'N'")
      expect(sql).toContain('created_at >= ?')
      expect(sql).toContain('created_at < ?')
      expect(sql).toContain('GROUP BY period')
      expect(sql).toContain('ORDER BY period')
      expect(sql).not.toContain('purged')
      expect(params).toEqual([FROM, TO])
      expect(rows).toEqual([
        { period: '2026-08-01', reports: 3 },
        { period: '2026-08-02', reports: 7 },
      ])
    })

    it('week: ISO week via YEARWEEK(created_at, 3) rendered as YYYY-Www', async () => {
      mockedPool.query.mockResolvedValue([[], undefined] as any)
      await repository.countByPeriod(exclusive, 'week')
      const [sql] = lastQuery()
      expect(sql).toContain('YEARWEEK(created_at, 3)')
      expect(sql).toContain("'-W'")
    })

    it("month: DATE_FORMAT '%Y-%m'", async () => {
      mockedPool.query.mockResolvedValue([[], undefined] as any)
      await repository.countByPeriod(exclusive, 'month')
      const [sql] = lastQuery()
      expect(sql).toContain("DATE_FORMAT(created_at, '%Y-%m')")
      expect(sql).not.toContain('%d')
    })

    it('an inclusive `to` compares with <=', async () => {
      mockedPool.query.mockResolvedValue([[], undefined] as any)
      await repository.countByPeriod(inclusive, 'day')
      const [sql, params] = lastQuery()
      expect(sql).toContain('created_at <= ?')
      expect(params).toEqual([FROM, TO])
    })
  })

  it('countTotals: one row of SUM(CASE ...) with the documented definitions', async () => {
    mockedPool.query.mockResolvedValue([
      [
        {
          reports: '10',
          open: '4',
          resolved: '6',
          anonymous: '7',
          identified: '3',
          frozen: '1',
          hidden: '2',
          expired: '5',
          purged: '3',
          withMedia: null,
        },
      ],
      undefined,
    ] as any)

    const row = await repository.countTotals(exclusive)

    const [sql, params] = lastQuery()
    expect(sql).toContain('COUNT(*) AS reports')
    expect(sql).toContain("r.status = 'open'")
    expect(sql).toContain("r.status = 'resolved'")
    expect(sql).toContain("r.anonymous = 'S'")
    expect(sql).toContain("r.anonymous = 'N'")
    expect(sql).toContain("r.frozen = 'S'")
    expect(sql).toContain("r.hidden = 'S'")
    expect(sql).toContain("r.purged = 'S'")
    // expired = resolved AND expires_at reached (purged or not).
    expect(sql).toContain("r.status = 'resolved' AND r.expires_at IS NOT NULL AND r.expires_at <= NOW()")
    // withMedia = at least one LIVING tb_media attached, any status (B1's hasMedia).
    expect(sql).toContain('EXISTS ( SELECT 1 FROM tb_report_media rm')
    expect(sql).toContain("JOIN tb_media m ON m.id = rm.tb_media_id AND m.deleted = 'N'")
    expect(sql).not.toContain("m.status")
    expect(sql).toContain("r.deleted = 'N' AND r.created_at >= ? AND r.created_at < ?")
    expect(params).toEqual([FROM, TO])
    expect(row).toEqual({
      reports: 10,
      open: 4,
      resolved: 6,
      anonymous: 7,
      identified: 3,
      frozen: 1,
      hidden: 2,
      expired: 5,
      purged: 3,
      withMedia: 0,
    })
  })

  it('countTotals: an empty range yields all zeros', async () => {
    mockedPool.query.mockResolvedValue([[], undefined] as any)
    const row = await repository.countTotals(exclusive)
    expect(Object.values(row).every((value) => value === 0)).toBe(true)
  })

  it('countByCategory groups by category, keeping NULL (free tag) as its own row', async () => {
    mockedPool.query.mockResolvedValue([
      [
        { category: null, reports: '2' },
        { category: 'assault', reports: '9' },
      ],
      undefined,
    ] as any)

    const rows = await repository.countByCategory(exclusive)

    const [sql, params] = lastQuery()
    expect(sql).toContain('GROUP BY category')
    expect(sql).toContain("deleted = 'N'")
    expect(params).toEqual([FROM, TO])
    expect(rows).toEqual([
      { category: null, reports: 2 },
      { category: 'assault', reports: 9 },
    ])
  })

  it('countBySubject / countByStatus group by their column', async () => {
    mockedPool.query.mockResolvedValue([[{ subject: 'child', reports: 1 }], undefined] as any)
    expect(await repository.countBySubject(exclusive)).toEqual([{ subject: 'child', reports: 1 }])
    expect(lastQuery()[0]).toContain('GROUP BY subject')

    mockedPool.query.mockResolvedValue([[{ status: 'open', reports: '4' }], undefined] as any)
    expect(await repository.countByStatus(inclusive)).toEqual([{ status: 'open', reports: 4 }])
    const [sql, params] = lastQuery()
    expect(sql).toContain('GROUP BY status')
    expect(sql).toContain('created_at <= ?')
    expect(params).toEqual([FROM, TO])
  })

  it('countHiddenByReason: currently hidden reports created in range, by hidden_reason_code', async () => {
    mockedPool.query.mockResolvedValue([[{ reasonCode: 'spam', reports: '6' }], undefined] as any)

    const rows = await repository.countHiddenByReason(exclusive)

    const [sql, params] = lastQuery()
    expect(sql).toContain("hidden = 'S'")
    expect(sql).toContain('hidden_reason_code AS reasonCode')
    expect(sql).toContain('GROUP BY hidden_reason_code')
    expect(sql).not.toContain('hidden_note')
    expect(sql).not.toContain('hidden_by')
    expect(params).toEqual([FROM, TO])
    expect(rows).toEqual([{ reasonCode: 'spam', reports: 6 }])
  })

  it('countBlockedMediaByReason: blocked living media attached to reports created in range, by blocked_reason_code', async () => {
    mockedPool.query.mockResolvedValue([
      [{ reasonCode: 'personal_data', media: '3' }],
      undefined,
    ] as any)

    const rows = await repository.countBlockedMediaByReason(exclusive)

    const [sql, params] = lastQuery()
    expect(sql).toContain('FROM tb_media m')
    expect(sql).toContain("JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'")
    expect(sql).toContain("JOIN tb_report r ON r.id = rm.tb_report_id AND r.deleted = 'N'")
    expect(sql).toContain("m.status = 'blocked'")
    expect(sql).toContain("m.deleted = 'N'")
    expect(sql).toContain('m.blocked_reason_code AS reasonCode')
    expect(sql).toContain('GROUP BY m.blocked_reason_code')
    expect(sql).toContain('r.created_at >= ? AND r.created_at < ?')
    expect(sql).not.toContain('blocked_note')
    expect(sql).not.toContain('blocked_by')
    expect(sql).not.toContain('public_id')
    expect(params).toEqual([FROM, TO])
    expect(rows).toEqual([{ reasonCode: 'personal_data', media: 3 }])
  })
})
