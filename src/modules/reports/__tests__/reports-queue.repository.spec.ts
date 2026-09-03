import pool from '@shared/db/connection'
import * as repository from '@modules/reports/reports.repository'
import { QueueTierSets } from '@modules/reports/reports.interface'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

const tiers: QueueTierSets = {
  tierCategories: {
    high: ['missing', 'kidnapping'],
    medium: ['assault'],
    low: ['theft', 'vandalism'],
  },
  freeTagTier: 'medium',
}

function calls(): Array<[string, unknown[]]> {
  return mockedPool.query.mock.calls.map(
    ([sql, params]) => [String(sql).replace(/\s+/g, ' '), params] as [string, unknown[]]
  )
}

function queueRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    category: 'missing',
    freeTag: null,
    subject: 'child',
    anonymous: 'S',
    status: 'open',
    frozen: 'S',
    purged: 'N',
    hidden: 'N',
    reviewedAt: null,
    lat: '-23.5',
    lng: '-46.6',
    createdAt: new Date('2026-09-02T03:30:00Z'),
    resolvedAt: null,
    mediaCount: '2',
    ...overrides,
  }
}

/** SQL contracts of the B3 queue (decision 161): the WHERE keeps only
 *  open / not reviewed / not hidden / not purged / living rows (frozen
 *  stays IN), the ORDER BY ranks the tier sets via CASE, then media
 *  presence, then age; markReviewed is an atomic reviewed_at IS NULL ->
 *  NOW() transition touching nothing else. */
describe('reports.repository — moderation queue SQL (decision 161)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('queueReports', () => {
    it('WHERE excludes reviewed / hidden / purged / deleted / non-open; frozen is NOT excluded; identity never loaded', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[queueRow()], undefined] as any)

      const { rows, total } = await repository.queueReports(tiers, 1, 20)

      expect(total).toBe(1)
      expect(rows).toEqual([
        expect.objectContaining({
          id: 7,
          frozen: true,
          reviewed: false,
          hidden: false,
          purged: false,
          mediaCount: 2,
          lat: -23.5,
          lng: -46.6,
        }),
      ])

      const [[countSql], [listSql, listParams]] = calls()
      for (const sql of [countSql, listSql]) {
        expect(sql).toContain("r.deleted = 'N'")
        expect(sql).toContain("r.status = 'open'")
        expect(sql).toContain('r.reviewed_at IS NULL')
        expect(sql).toContain("r.hidden = 'N'")
        expect(sql).toContain("r.purged = 'N'")
        expect(sql).not.toContain('r.frozen =')
        expect(sql).not.toContain('client_key')
        expect(sql).not.toContain('reporter_account_id')
      }
      expect(listParams.slice(-2)).toEqual([20, 0])
    })

    it('ORDER BY: CASE over the tier sets (high 0, medium 1, low 2, free tag by its own tier), then media presence DESC, then oldest first, id tiebreaker', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 3 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.queueReports(tiers, 2, 10)

      const [, [listSql, listParams]] = calls()
      const orderBy = listSql.slice(listSql.indexOf('ORDER BY'))
      expect(orderBy).toMatch(/ORDER BY CASE/)
      expect(orderBy).toContain('r.category IS NULL THEN ?')
      expect(orderBy).toContain('r.category IN (?, ?) THEN 0')
      expect(orderBy).toContain('r.category IN (?) THEN 1')
      expect(orderBy).toContain('r.category IN (?, ?) THEN 2')
      expect(orderBy.indexOf('THEN 0')).toBeLessThan(orderBy.indexOf('THEN 1'))
      expect(orderBy.indexOf('THEN 1')).toBeLessThan(orderBy.indexOf('THEN 2'))

      const caseEnd = orderBy.indexOf(' END')
      const mediaIdx = orderBy.indexOf('EXISTS')
      const createdIdx = orderBy.indexOf('r.created_at ASC')
      const idIdx = orderBy.indexOf('r.id ASC')
      expect(caseEnd).toBeGreaterThan(-1)
      expect(mediaIdx).toBeGreaterThan(caseEnd)
      expect(orderBy.slice(mediaIdx, createdIdx)).toContain('DESC')
      expect(createdIdx).toBeGreaterThan(mediaIdx)
      expect(idIdx).toBeGreaterThan(createdIdx)
      expect(orderBy).not.toContain('created_at DESC')
      // The media EXISTS counts LIVING tb_media rows, any status (B1's hasMedia).
      expect(orderBy.slice(mediaIdx, createdIdx)).toContain("m.deleted = 'N'")

      // Params: free-tag rank, then the sets in tier order, then LIMIT/OFFSET.
      expect(listParams).toEqual([1, 'missing', 'kidnapping', 'assault', 'theft', 'vandalism', 10, 10])
    })

    it('an empty tier set drops its WHEN clause instead of emitting IN ()', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.queueReports(
        { tierCategories: { high: [], medium: ['assault'], low: [] }, freeTagTier: 'high' },
        1,
        20
      )

      const [, [listSql, listParams]] = calls()
      expect(listSql).not.toContain('IN ()')
      expect(listSql).not.toContain('THEN 0')
      expect(listSql).toContain('r.category IN (?) THEN 1')
      expect(listSql).not.toContain('THEN 2')
      expect(listParams).toEqual([0, 'assault', 20, 0])
    })

    it('skips the list query when the count is 0', async () => {
      mockedPool.query.mockResolvedValueOnce([[{ total: 0 }], undefined] as any)
      const result = await repository.queueReports(tiers, 1, 20)
      expect(result).toEqual({ rows: [], total: 0 })
      expect(mockedPool.query).toHaveBeenCalledTimes(1)
    })

    it('a hidden case leaves the queue: hideReport flips the SAME column the queue WHERE keys on', async () => {
      mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)
      await repository.hideReport(7, 'spam', null, 3)
      expect(calls()[0][0]).toContain("hidden = 'S'")

      jest.resetAllMocks()
      mockedPool.query.mockResolvedValueOnce([[{ total: 0 }], undefined] as any)
      await repository.queueReports(tiers, 1, 20)
      expect(calls()[0][0]).toContain("r.hidden = 'N'")
    })
  })

  describe('markReviewed', () => {
    it('is an atomic reviewed_at IS NULL -> NOW() transition stamping the actor and nothing else', async () => {
      mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)

      const transitioned = await repository.markReviewed(7, 3)

      expect(transitioned).toBe(true)
      const [[sql, params]] = calls()
      expect(sql).toContain('UPDATE tb_report')
      expect(sql).toContain('reviewed_at = NOW()')
      expect(sql).toContain('reviewed_by = ?')
      expect(sql).toContain("WHERE id = ? AND reviewed_at IS NULL AND deleted = 'N'")
      expect(params).toEqual([3, 7])
      // Not a moderation act, not a lifecycle act (161/162): none of these move.
      expect(sql).not.toContain('hidden')
      expect(sql).not.toContain('frozen')
      expect(sql).not.toContain('expires_at')
      expect(sql).not.toContain('status')
      expect(sql).not.toContain('tb_report_timeline')
      expect(mockedPool.query).toHaveBeenCalledTimes(1)
    })

    it('reports an already-reviewed row as false (0 rows)', async () => {
      mockedPool.query.mockResolvedValue([{ affectedRows: 0 }, undefined] as any)
      expect(await repository.markReviewed(7, 3)).toBe(false)
    })
  })

  describe('review columns on the existing reads', () => {
    it('findById projects reviewed_at / reviewed_by', async () => {
      const at = new Date('2026-09-02T10:00:00Z')
      mockedPool.query.mockResolvedValueOnce([
        [
          {
            id: 7,
            clientKey: 'k',
            category: 'assault',
            freeTag: null,
            subject: 'adult',
            detailFields: null,
            lat: '-23.5',
            lng: '-46.6',
            anonymous: 'N',
            reporterAccountId: 42,
            status: 'open',
            resolvedAt: null,
            expiresAt: null,
            frozen: 'N',
            frozenReason: null,
            frozenAt: null,
            purged: 'N',
            hidden: 'N',
            hiddenReasonCode: null,
            hiddenNote: null,
            hiddenAt: null,
            hiddenBy: null,
            reviewedAt: at,
            reviewedBy: 3,
            createdAt: new Date('2026-08-03T12:00:00Z'),
          },
        ],
        undefined,
      ] as any)

      const row = await repository.findById(7)

      const [[sql]] = calls()
      expect(sql).toContain('reviewed_at AS reviewedAt')
      expect(sql).toContain('reviewed_by AS reviewedBy')
      expect(row).toMatchObject({ reviewedAt: at, reviewedBy: 3 })
    })

    it('searchReports filters on reviewed (IS NOT NULL / IS NULL) and projects the mark', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([
          [queueRow({ frozen: 'N', reviewedAt: new Date('2026-09-02T10:00:00Z') })],
          undefined,
        ] as any)

      const { rows } = await repository.searchReports({ reviewed: true }, 1, 20)

      const [[countSql], [listSql]] = calls()
      expect(countSql).toContain('r.reviewed_at IS NOT NULL')
      expect(listSql).toContain('r.reviewed_at AS reviewedAt')
      expect(rows[0].reviewed).toBe(true)

      jest.resetAllMocks()
      mockedPool.query.mockResolvedValueOnce([[{ total: 0 }], undefined] as any)
      await repository.searchReports({ reviewed: false }, 1, 20)
      expect(calls()[0][0]).toContain('r.reviewed_at IS NULL')
      expect(calls()[0][0]).not.toContain('IS NOT NULL')
    })
  })
})
