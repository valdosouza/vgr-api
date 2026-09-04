import pool from '@shared/db/connection'
import * as repository from '@modules/ratings/helper-rating.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn(), getConnection: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock; getConnection: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ')

describe('helper-rating.repository — SQL contracts (migration 045, decisions 180-187)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('findReportForRating', () => {
    it('reads the guard columns of a living report (deleted rows are gone; purged rows come back)', async () => {
      mockedPool.query.mockResolvedValueOnce([
        [
          {
            id: 7,
            clientKey: 'k',
            reporterAccountId: null,
            status: 'resolved',
            hidden: 'S',
            purged: 'N',
          },
        ],
      ])

      const row = await repository.findReportForRating(7)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_report')
      expect(flat(sql)).toContain("deleted = 'N'")
      expect(params).toEqual([7])
      expect(row).toEqual({
        id: 7,
        clientKey: 'k',
        reporterAccountId: null,
        status: 'resolved',
        hidden: true,
        purged: false,
      })
    })

    it('null when nothing matches', async () => {
      mockedPool.query.mockResolvedValueOnce([[]])
      expect(await repository.findReportForRating(7)).toBeNull()
    })
  })

  describe('findOfferForRating', () => {
    it('matches the offer by id AND report id, living rows only', async () => {
      mockedPool.query.mockResolvedValueOnce([
        [{ id: 11, reportId: 7, helperAccountId: null, anonymous: 'S' }],
      ])

      const row = await repository.findOfferForRating(11, 7)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_help_offer')
      expect(flat(sql)).toContain('id = ?')
      expect(flat(sql)).toContain('tb_report_id = ?')
      expect(flat(sql)).toContain("deleted = 'N'")
      expect(params).toEqual([11, 7])
      expect(row).toEqual({ id: 11, reportId: 7, helperAccountId: null, anonymous: true })
    })
  })

  describe('findRatingByOffer', () => {
    it('reads the living rating of an offer', async () => {
      const createdAt = new Date('2026-09-03T12:00:00Z')
      mockedPool.query.mockResolvedValueOnce([
        [
          {
            id: 501,
            helpOfferId: 11,
            reportId: 7,
            helperAccountId: 8,
            score: 4,
            clientKey: 'r',
            createdAt,
          },
        ],
      ])

      const row = await repository.findRatingByOffer(11)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_helper_rating')
      expect(flat(sql)).toContain('tb_help_offer_id = ?')
      expect(flat(sql)).toContain("deleted = 'N'")
      expect(params).toEqual([11])
      expect(row).toEqual({
        id: 501,
        helpOfferId: 11,
        reportId: 7,
        helperAccountId: 8,
        score: 4,
        clientKey: 'r',
        createdAt,
      })
    })
  })

  describe('insertRating (append-only, 183)', () => {
    const input = { helpOfferId: 11, reportId: 7, helperAccountId: 8, score: 4, clientKey: 'r' }

    it('inserts the five columns and reads the row back', async () => {
      mockedPool.query
        .mockResolvedValueOnce([{ insertId: 501 }])
        .mockResolvedValueOnce([
          [
            {
              id: 501,
              helpOfferId: 11,
              reportId: 7,
              helperAccountId: 8,
              score: 4,
              clientKey: 'r',
              createdAt: new Date('2026-09-03T12:00:00Z'),
            },
          ],
        ])

      const row = await repository.insertRating(input)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('INSERT INTO tb_helper_rating')
      expect(params).toEqual([11, 7, 8, 4, 'r'])
      expect(row?.id).toBe(501)
      expect(row?.score).toBe(4)
    })

    it('a UNIQUE collision (offer or clientKey) returns null instead of throwing — the caller re-reads', async () => {
      mockedPool.query.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
      )
      expect(await repository.insertRating(input)).toBeNull()
    })

    it('any other failure is rethrown', async () => {
      mockedPool.query.mockRejectedValueOnce(new Error('boom'))
      await expect(repository.insertRating(input)).rejects.toThrow('boom')
    })
  })

  describe('aggregateByHelperInternalId (decisions 184/187/189)', () => {
    it('counts and averages in SQL, EXCLUDING ratings whose report is currently hidden', async () => {
      mockedPool.query.mockResolvedValueOnce([[{ count: 6, average: 4.1667 }]])

      const agg = await repository.aggregateByHelperInternalId(8)

      const [sql, params] = mockedPool.query.mock.calls[0]
      const s = flat(sql)
      expect(s).toContain('COUNT(')
      expect(s).toContain('AVG(')
      expect(s).toContain('FROM tb_helper_rating')
      expect(s).toMatch(/JOIN tb_report/)
      expect(s).toContain("hidden = 'N'")
      expect(s).toContain('helper_account_id = ?')
      expect(s).toContain("deleted = 'N'")
      expect(params).toEqual([8])
      expect(agg).toEqual({ count: 6, average: 4.1667 })
    })

    it('an empty aggregate is { count: 0, average: null } (AVG of nothing is NULL)', async () => {
      mockedPool.query.mockResolvedValueOnce([[{ count: 0, average: null }]])
      expect(await repository.aggregateByHelperInternalId(8)).toEqual({ count: 0, average: null })
    })

    it('a driver that hands strings back is normalized to numbers', async () => {
      mockedPool.query.mockResolvedValueOnce([[{ count: '5', average: '3.8000' }]])
      expect(await repository.aggregateByHelperInternalId(8)).toEqual({ count: 5, average: 3.8 })
    })
  })

  it('exposes no update nor delete — the rating is immutable (183)', () => {
    const exported = Object.keys(repository)
    expect(exported.some((name) => /update|delete|remove/i.test(name))).toBe(false)
  })
})
