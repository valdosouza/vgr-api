import pool from '@shared/db/connection'
import * as repository from '@modules/help-offers/help-offers.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn(), getConnection: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock; getConnection: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ')

function connection() {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn(),
  }
  mockedPool.getConnection.mockResolvedValue(conn)
  return conn
}

/** SQL contracts of migration 049 (decisions 208-212): the fronts live in
 *  tb_help_offer_type, written with the offer in ONE transaction and read
 *  back as one GROUP_CONCAT per offer. */
describe('help-offers.repository — SQL contracts (migration 049)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('insertHelpOffer', () => {
    it('inserts the offer WITHOUT a help_type column, then one child row per front, in one transaction', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([{ affectedRows: 2 }])

      const id = await repository.insertHelpOffer({
        reportId: 7,
        helperAccountId: 8,
        anonymous: false,
        helpTypes: ['physical_presence', 'share'],
      })

      expect(id).toBe(11)
      const [offerSql, offerParams] = conn.query.mock.calls[0]
      expect(flat(offerSql)).toContain(
        'INSERT INTO tb_help_offer (tb_report_id, helper_account_id, anonymous) VALUES (?, ?, ?)'
      )
      expect(offerParams).toEqual([7, 8, 'N'])
      const [typesSql, typesParams] = conn.query.mock.calls[1]
      expect(flat(typesSql)).toContain(
        'INSERT INTO tb_help_offer_type (tb_help_offer_id, help_type) VALUES ?'
      )
      expect(typesParams).toEqual([
        [
          [11, 'physical_presence'],
          [11, 'share'],
        ],
      ])
      expect(conn.beginTransaction).toHaveBeenCalled()
      expect(conn.commit).toHaveBeenCalled()
      expect(conn.rollback).not.toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })

    it('rolls back when the child insert fails — an offer with zero fronts is never observable (208)', async () => {
      const conn = connection()
      conn.query.mockResolvedValueOnce([{ insertId: 11 }]).mockRejectedValueOnce(new Error('boom'))

      await expect(
        repository.insertHelpOffer({
          reportId: 7,
          helperAccountId: null,
          anonymous: true,
          helpTypes: ['share'],
        })
      ).rejects.toThrow('boom')

      expect(conn.rollback).toHaveBeenCalled()
      expect(conn.commit).not.toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })
  })

  describe('replaceHelpOfferTypes (211)', () => {
    it('deletes then re-inserts the set atomically', async () => {
      const conn = connection()
      conn.query.mockResolvedValue([{}])

      await repository.replaceHelpOfferTypes(11, ['remote_support'])

      expect(flat(conn.query.mock.calls[0][0])).toContain(
        'DELETE FROM tb_help_offer_type WHERE tb_help_offer_id = ?'
      )
      expect(conn.query.mock.calls[0][1]).toEqual([11])
      expect(conn.query.mock.calls[1][1]).toEqual([[[11, 'remote_support']]])
      expect(conn.commit).toHaveBeenCalled()
    })
  })

  describe('readers', () => {
    it('findOfferForUpdate joins the living report and splits the GROUP_CONCAT into a sorted array', async () => {
      mockedPool.query.mockResolvedValueOnce([
        [
          {
            id: 11,
            reportId: 7,
            helperAccountId: 8,
            anonymous: 'N',
            createdAt: new Date('2026-09-11T00:00:00Z'),
            helpTypes: 'physical_presence,share',
            reportStatus: 'open',
          },
        ],
      ])

      const row = await repository.findOfferForUpdate(11)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toMatch(
        /GROUP_CONCAT\(t\.help_type ORDER BY t\.help_type\) FROM tb_help_offer_type t WHERE t\.tb_help_offer_id = o\.id/
      )
      expect(flat(sql)).toContain(
        "JOIN tb_report r ON r.id = o.tb_report_id AND r.deleted = 'N' AND r.purged = 'N'"
      )
      expect(flat(sql)).toContain("WHERE o.id = ? AND o.deleted = 'N'")
      expect(params).toEqual([11])
      expect(row).toEqual({
        id: 11,
        reportId: 7,
        helperAccountId: 8,
        anonymous: false,
        helpTypes: ['physical_presence', 'share'],
        createdAt: new Date('2026-09-11T00:00:00Z'),
        reportStatus: 'open',
      })
    })

    it('findByReport never selects a help_type column from tb_help_offer (210)', async () => {
      mockedPool.query.mockResolvedValueOnce([[]])
      await repository.findByReport(7)
      const [sql] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).not.toContain('o.help_type')
    })
  })

  describe('timeline items (212)', () => {
    it('help_offered carries the whole set in one item', async () => {
      mockedPool.query.mockResolvedValueOnce([{}])
      await repository.appendHelpOfferedEvent(7, ['physical_presence', 'share'])
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("VALUES (?, 'help_offered', ?)")
      expect(params).toEqual([7, JSON.stringify({ helpTypes: ['physical_presence', 'share'] })])
    })

    it('help_offer_updated is its own item', async () => {
      mockedPool.query.mockResolvedValueOnce([{}])
      await repository.appendHelpOfferUpdatedEvent(7, ['share'])
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("VALUES (?, 'help_offer_updated', ?)")
      expect(params).toEqual([7, JSON.stringify({ helpTypes: ['share'] })])
    })
  })
})
