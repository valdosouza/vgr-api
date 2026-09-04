import pool from '@shared/db/connection'
import * as repository from '@modules/panic/panic-alert.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

const ROW = {
  id: 501,
  clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
  accountId: 42,
  lat: '-23.550000',
  lng: '-46.630000',
  status: 'active',
  createdAt: new Date('2026-09-04T12:00:00Z'),
  resolvedAt: null,
}

describe('panic-alert.repository — SQL contracts (migration 046)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('findAlertByClientKey', () => {
    it('selects by client_key and coerces DECIMAL strings to numbers', async () => {
      mockedPool.query.mockResolvedValue([[ROW]])

      const alert = await repository.findAlertByClientKey(ROW.clientKey)

      expect(alert).toEqual({
        id: 501,
        clientKey: ROW.clientKey,
        accountId: 42,
        lat: -23.55,
        lng: -46.63,
        status: 'active',
        createdAt: ROW.createdAt,
        resolvedAt: null,
      })
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('WHERE client_key = ?')
      expect(params).toEqual([ROW.clientKey])
    })

    it('returns null when nothing matches', async () => {
      mockedPool.query.mockResolvedValue([[]])
      expect(await repository.findAlertByClientKey('missing')).toBeNull()
    })
  })

  describe('findActiveAlertByAccount (cooldown, 198)', () => {
    it('filters by account_id AND status = active', async () => {
      mockedPool.query.mockResolvedValue([[ROW]])

      await repository.findActiveAlertByAccount(42)

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("WHERE account_id = ? AND status = 'active'")
      expect(params).toEqual([42])
    })
  })

  describe('findAlertById', () => {
    it('selects by id with no status filter (resolve needs both states)', async () => {
      mockedPool.query.mockResolvedValue([[{ ...ROW, status: 'resolved' }]])
      const alert = await repository.findAlertById(501)
      expect(alert?.status).toBe('resolved')
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('WHERE id = ?')
      expect(params).toEqual([501])
    })
  })

  describe('insertAlert', () => {
    it('inserts with status active then reads the row back', async () => {
      mockedPool.query
        .mockResolvedValueOnce([{ insertId: 501 }])
        .mockResolvedValueOnce([[ROW]])

      const alert = await repository.insertAlert({
        clientKey: ROW.clientKey,
        accountId: 42,
        lat: -23.55,
        lng: -46.63,
      })

      expect(alert.id).toBe(501)
      const [insertSql, insertParams] = mockedPool.query.mock.calls[0]
      expect(flat(insertSql)).toContain('INSERT INTO tb_panic_alert')
      expect(flat(insertSql)).toContain("'active'")
      expect(insertParams).toEqual([ROW.clientKey, 42, -23.55, -46.63])
      const [selectSql, selectParams] = mockedPool.query.mock.calls[1]
      expect(flat(selectSql)).toContain('WHERE id = ?')
      expect(selectParams).toEqual([501])
    })
  })

  describe('insertRecipients (snapshot at trigger time, 65/192)', () => {
    it('bulk inserts one row per responder', async () => {
      mockedPool.query.mockResolvedValue([{}])

      await repository.insertRecipients(501, [8, 9, 10])

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('INSERT INTO tb_panic_alert_recipient')
      expect(flat(sql)).toMatch(/VALUES \(\?, \?\), \(\?, \?\), \(\?, \?\)/)
      expect(params).toEqual([501, 8, 501, 9, 501, 10])
    })

    it('never queries the database for an EMPTY pool — no refusal, no wasted round-trip', async () => {
      await repository.insertRecipients(501, [])
      expect(mockedPool.query).not.toHaveBeenCalled()
    })
  })

  describe('countRecipients', () => {
    it('counts by tb_panic_alert_id', async () => {
      mockedPool.query.mockResolvedValue([[{ total: 3 }]])
      const count = await repository.countRecipients(501)
      expect(count).toBe(3)
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('WHERE tb_panic_alert_id = ?')
      expect(params).toEqual([501])
    })

    it('defaults to 0 on an empty result', async () => {
      mockedPool.query.mockResolvedValue([[]])
      expect(await repository.countRecipients(501)).toBe(0)
    })
  })

  describe('resolveAlert (atomic active -> resolved, 197/198)', () => {
    it('the WHERE clause gates on status = active — 0 affected rows = already resolved', async () => {
      mockedPool.query.mockResolvedValue([{ affectedRows: 1 }])

      const transitioned = await repository.resolveAlert(501)

      expect(transitioned).toBe(true)
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain("SET status = 'resolved', resolved_at = NOW()")
      expect(flat(sql)).toContain("WHERE id = ? AND status = 'active'")
      expect(params).toEqual([501])
    })

    it('returns false when zero rows were affected', async () => {
      mockedPool.query.mockResolvedValue([{ affectedRows: 0 }])
      expect(await repository.resolveAlert(501)).toBe(false)
    })
  })

  describe('findAlertsForResponder (inbox, 192)', () => {
    it('joins the recipient snapshot to the alert, filters by responder and cursor, orders ascending by alert id', async () => {
      const inboxRow = {
        alertId: 501,
        lat: ROW.lat,
        lng: ROW.lng,
        status: 'active',
        createdAt: ROW.createdAt,
      }
      mockedPool.query.mockResolvedValue([[inboxRow]])

      const rows = await repository.findAlertsForResponder(8, 100, 50)

      expect(rows).toEqual([
        { alertId: 501, lat: -23.55, lng: -46.63, status: 'active', createdAt: ROW.createdAt },
      ])
      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('FROM tb_panic_alert_recipient r')
      expect(flat(sql)).toContain('JOIN tb_panic_alert a ON a.id = r.tb_panic_alert_id')
      expect(flat(sql)).toContain('WHERE r.responder_account_id = ? AND a.id > ?')
      expect(flat(sql)).toContain('ORDER BY a.id')
      expect(params).toEqual([8, 100, 50])
    })
  })
})
