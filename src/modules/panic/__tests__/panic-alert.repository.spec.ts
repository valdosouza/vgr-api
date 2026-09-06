import pool from '@shared/db/connection'
import * as repository from '@modules/panic/panic-alert.repository'

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

  describe('insertAlertWithRecipients (alert + trigger-time snapshot in ONE transaction, 65/192)', () => {
    const INPUT = { clientKey: ROW.clientKey, accountId: 42, lat: -23.55, lng: -46.63 }

    it('inserts the alert with status active, bulk inserts one recipient row per responder, reads the alert back and commits', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 501 }]) // INSERT tb_panic_alert
        .mockResolvedValueOnce([{}]) // INSERT tb_panic_alert_recipient
        .mockResolvedValueOnce([[ROW]]) // SELECT the alert back

      const alert = await repository.insertAlertWithRecipients(INPUT, [8, 9, 10])

      expect(alert.id).toBe(501)
      expect(conn.beginTransaction).toHaveBeenCalled()
      const [insertSql, insertParams] = conn.query.mock.calls[0]
      expect(flat(insertSql)).toContain('INSERT INTO tb_panic_alert')
      expect(flat(insertSql)).toContain("'active'")
      expect(insertParams).toEqual([ROW.clientKey, 42, -23.55, -46.63])

      const [recipientsSql, recipientsParams] = conn.query.mock.calls[1]
      expect(flat(recipientsSql)).toContain('INSERT INTO tb_panic_alert_recipient')
      expect(flat(recipientsSql)).toMatch(/VALUES \(\?, \?\), \(\?, \?\), \(\?, \?\)/)
      expect(recipientsParams).toEqual([501, 8, 501, 9, 501, 10])

      const [selectSql, selectParams] = conn.query.mock.calls[2]
      expect(flat(selectSql)).toContain('WHERE id = ?')
      expect(selectParams).toEqual([501])

      expect(conn.commit).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
      // Every statement rides the transaction's connection, never the pool.
      expect(mockedPool.query).not.toHaveBeenCalled()
    })

    it('still commits the alert for an EMPTY pool — no recipient INSERT, no refusal (decision 65)', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 501 }]) // INSERT tb_panic_alert
        .mockResolvedValueOnce([[ROW]]) // SELECT the alert back

      const alert = await repository.insertAlertWithRecipients(INPUT, [])

      expect(alert.id).toBe(501)
      expect(conn.query).toHaveBeenCalledTimes(2)
      const statements = conn.query.mock.calls.map(([sql]) => flat(sql))
      expect(statements.some((sql) => sql.includes('tb_panic_alert_recipient'))).toBe(false)
      expect(conn.commit).toHaveBeenCalled()
      expect(conn.rollback).not.toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })

    it('rolls back and releases the connection when the recipient insert fails — never an orphaned active alert', async () => {
      const conn = connection()
      conn.query
        .mockResolvedValueOnce([{ insertId: 501 }]) // INSERT tb_panic_alert
        .mockRejectedValueOnce(new Error('FK failed')) // INSERT tb_panic_alert_recipient

      await expect(repository.insertAlertWithRecipients(INPUT, [8])).rejects.toThrow('FK failed')

      expect(conn.rollback).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
      expect(conn.commit).not.toHaveBeenCalled()
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
