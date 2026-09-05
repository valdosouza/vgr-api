import pool from '@shared/db/connection'
import * as repository from '@modules/direction-sightings/direction-sightings.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn(), getConnection: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock; getConnection: jest.Mock }

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

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

const CLIENT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'

const SIGHTING_ROW = {
  id: 501,
  reportId: 7,
  direction: 'N',
  weight: '1.00',
  accountId: 42,
  clientKey: CLIENT_KEY,
  createdAt: new Date('2026-09-04T12:00:00Z'),
}

describe('direction-sightings.repository — SQL contracts (migration 047)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('findReportForSighting', () => {
    it('selects the guard columns only, over tb_report — table access, not a module import', async () => {
      mockedPool.query.mockResolvedValue([[
        { id: 7, reporterAccountId: 42, status: 'open', category: 'robbery' },
      ]])

      const report = await repository.findReportForSighting(7)

      expect(report).toEqual({ id: 7, reporterAccountId: 42, status: 'open', category: 'robbery' })
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_report')
      expect(flat(sql)).toContain("deleted = 'N'")
      expect(params).toEqual([7])
    })

    it('returns null when the report does not exist', async () => {
      mockedPool.query.mockResolvedValue([[]])
      expect(await repository.findReportForSighting(999)).toBeNull()
    })
  })

  describe('findSightingByClientKey (idempotency, 137)', () => {
    it('selects by client_key and coerces the DECIMAL weight to a number', async () => {
      mockedPool.query.mockResolvedValue([[SIGHTING_ROW]])

      const sighting = await repository.findSightingByClientKey(CLIENT_KEY)

      expect(sighting).toEqual({
        id: 501,
        reportId: 7,
        direction: 'N',
        weight: 1,
        accountId: 42,
        clientKey: CLIENT_KEY,
        createdAt: SIGHTING_ROW.createdAt,
      })
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('WHERE client_key = ?')
      expect(params).toEqual([CLIENT_KEY])
    })

    it('returns null when nothing matches', async () => {
      mockedPool.query.mockResolvedValue([[]])
      expect(await repository.findSightingByClientKey('missing')).toBeNull()
    })
  })

  describe('insertSighting (append-only log + O(1) aggregate update, decision 22)', () => {
    it('inserts the sighting AND upserts the aggregate in ONE transaction, then reads the sighting back', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 501 }]) // INSERT tb_direction_sighting
        .mockResolvedValueOnce([{}]) // upsert tb_direction_estimate
        .mockResolvedValueOnce([[SIGHTING_ROW]]) // SELECT the row back

      const sighting = await repository.insertSighting({
        reportId: 7,
        direction: 'N',
        weight: 1,
        accountId: 42,
        clientKey: CLIENT_KEY,
      })

      expect(sighting.id).toBe(501)
      expect(conn.beginTransaction).toHaveBeenCalled()
      const [insertSql, insertParams] = conn.query.mock.calls[0]
      expect(flat(insertSql)).toContain('INSERT INTO tb_direction_sighting')
      expect(insertParams).toEqual([7, 'N', 1, 42, CLIENT_KEY])

      const [upsertSql, upsertParams] = conn.query.mock.calls[1]
      expect(flat(upsertSql)).toContain('INSERT INTO tb_direction_estimate')
      expect(flat(upsertSql)).toContain('ON DUPLICATE KEY UPDATE')
      // first_reported_at is set ONLY on the initial insert branch — never
      // touched by the UPDATE clause (it is the tie-break key, decision 26).
      expect(flat(upsertSql)).not.toMatch(/UPDATE[^,]*first_reported_at/i)
      expect(flat(upsertSql)).toContain('total_weight = total_weight + VALUES(total_weight)')
      expect(flat(upsertSql)).toContain('sighting_count = sighting_count + 1')
      expect(upsertParams).toEqual([7, 'N', 1])

      expect(conn.commit).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })

    it('rolls back and releases the connection if the aggregate upsert fails', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 501 }])
        .mockRejectedValueOnce(new Error('db down'))

      await expect(
        repository.insertSighting({
          reportId: 7,
          direction: 'N',
          weight: 1,
          accountId: 42,
          clientKey: CLIENT_KEY,
        })
      ).rejects.toThrow('db down')

      expect(conn.rollback).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
      expect(conn.commit).not.toHaveBeenCalled()
    })
  })

  describe('findEstimateRows (reconciliation input, decisions 22/26/202)', () => {
    it('selects the per-direction accumulator rows for one report', async () => {
      mockedPool.query.mockResolvedValue([[
        { direction: 'N', totalWeight: '2.50', sightingCount: 3, firstReportedAt: SIGHTING_ROW.createdAt },
        { direction: 'S', totalWeight: '1.00', sightingCount: 1, firstReportedAt: SIGHTING_ROW.createdAt },
      ]])

      const rows = await repository.findEstimateRows(7)

      expect(rows).toEqual([
        { direction: 'N', totalWeight: 2.5, sightingCount: 3, firstReportedAt: SIGHTING_ROW.createdAt },
        { direction: 'S', totalWeight: 1, sightingCount: 1, firstReportedAt: SIGHTING_ROW.createdAt },
      ])
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_direction_estimate')
      expect(flat(sql)).toContain('WHERE tb_report_id = ?')
      expect(params).toEqual([7])
    })

    it('returns an empty array when the report has no sightings yet', async () => {
      mockedPool.query.mockResolvedValue([[]])
      expect(await repository.findEstimateRows(7)).toEqual([])
    })
  })
})
