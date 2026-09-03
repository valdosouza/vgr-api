import pool from '@shared/db/connection'
import * as repository from '@modules/messaging/chat.repository'

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

const flat = (sql: string) => sql.replace(/\s+/g, ' ')

describe('chat.repository — SQL contracts (migration 043, decisions 169-177)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('insertThreadWithParticipants (find-or-create, 173)', () => {
    const input = {
      reportId: 7,
      helperAccountId: 8,
      helpOfferId: 11,
      reporter: { accountId: null, clientKey: 'k', token: 'a'.repeat(32) },
      helper: { accountId: 8, token: 'b'.repeat(32) },
    }

    it('inserts the thread and BOTH masks in one transaction', async () => {
      const conn = connection()
      conn.query.mockResolvedValueOnce([{ insertId: 3 }]).mockResolvedValueOnce([{}])

      const id = await repository.insertThreadWithParticipants(input)

      expect(id).toBe(3)
      expect(conn.beginTransaction).toHaveBeenCalled()
      const [threadSql, threadParams] = conn.query.mock.calls[0]
      expect(flat(threadSql)).toContain('INSERT INTO tb_chat_thread')
      expect(threadParams).toEqual([7, 8, 11])
      const [participantSql, participantParams] = conn.query.mock.calls[1]
      expect(flat(participantSql)).toContain('INSERT INTO tb_chat_participant')
      expect(flat(participantSql)).toContain("'reporter'")
      expect(flat(participantSql)).toContain("'helper'")
      expect(participantParams).toEqual([3, null, 'k', 'a'.repeat(32), 3, 8, 'b'.repeat(32)])
      expect(conn.commit).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })

    it('a UNIQUE (report, helper) collision rolls back and returns null — the caller reads the winner', async () => {
      const conn = connection()
      conn.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))

      const id = await repository.insertThreadWithParticipants(input)

      expect(id).toBeNull()
      expect(conn.rollback).toHaveBeenCalled()
      expect(conn.commit).not.toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })

    it('any other failure rolls back and rethrows', async () => {
      const conn = connection()
      conn.query.mockResolvedValueOnce([{ insertId: 3 }]).mockRejectedValueOnce(new Error('boom'))
      await expect(repository.insertThreadWithParticipants(input)).rejects.toThrow('boom')
      expect(conn.rollback).toHaveBeenCalled()
      expect(conn.release).toHaveBeenCalled()
    })
  })

  describe('insertMessage (append-only, idempotent by clientKey — 172/177)', () => {
    it('inserts then reads the row back', async () => {
      mockedPool.query
        .mockResolvedValueOnce([{ insertId: 101 }])
        .mockResolvedValueOnce([
          [
            {
              id: 101,
              threadId: 3,
              senderParticipantId: 32,
              clientKey: 'm',
              text: 'oi',
              purged: 'N',
              createdAt: new Date('2026-09-03T10:00:00Z'),
            },
          ],
        ])

      const row = await repository.insertMessage({
        threadId: 3,
        senderParticipantId: 32,
        clientKey: 'm',
        text: 'oi',
      })

      const [sql, params] = mockedPool.query.mock.calls[0]
      expect(flat(sql)).toContain('INSERT INTO tb_chat_message')
      expect(params).toEqual([3, 32, 'm', 'oi'])
      expect(row).toEqual({
        id: 101,
        threadId: 3,
        senderParticipantId: 32,
        clientKey: 'm',
        text: 'oi',
        purged: false,
        createdAt: new Date('2026-09-03T10:00:00Z'),
      })
    })

    it('a clientKey race (ER_DUP_ENTRY) returns null instead of throwing', async () => {
      mockedPool.query.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
      )
      const row = await repository.insertMessage({
        threadId: 3,
        senderParticipantId: 32,
        clientKey: 'm',
        text: 'oi',
      })
      expect(row).toBeNull()
    })

    it('no update/delete statement exists for messages (177)', () => {
      const exported = Object.keys(repository)
      expect(exported.some((name) => /update.*message|delete.*message/i.test(name))).toBe(false)
    })
  })

  it('findOfferByAccount only matches IDENTIFIED offers (helper_account_id = ?) — never NULL (169)', async () => {
    mockedPool.query.mockResolvedValue([[]])
    await repository.findOfferByAccount(7, 8)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('o.helper_account_id = ?')
    expect(flat(sql)).toContain("o.deleted = 'N'")
    expect(params).toEqual([7, 8])
  })

  it('thread reads join the offer anonymity and the display name for masking, never the e-mail', async () => {
    mockedPool.query.mockResolvedValue([
      [
        {
          id: 3,
          reportId: 7,
          helperAccountId: 8,
          helpOfferId: 11,
          createdAt: new Date(),
          offerAnonymous: 'S',
          helperDisplayName: 'Ana',
          lastMessageAt: null,
        },
      ],
    ])
    const thread = await repository.findThreadByReportAndHelper(7, 8)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('o.anonymous AS offerAnonymous')
    expect(flat(sql)).toContain('a.display_name AS helperDisplayName')
    expect(flat(sql)).not.toContain('email')
    expect(flat(sql)).toContain("t.deleted = 'N'")
    expect(params).toEqual([7, 8])
    expect(thread).toMatchObject({ offerAnonymous: true, helperDisplayName: 'Ana', lastMessageAt: null })
  })

  it('listMessages pages ascending by id from the cursor with the limit (172)', async () => {
    mockedPool.query.mockResolvedValue([[]])
    await repository.listMessages(3, 100, 20)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('WHERE tb_chat_thread_id = ? AND id > ? ORDER BY id LIMIT ?')
    expect(params).toEqual([3, 100, 20])
  })

  it('countRecentMessages counts the sliding window on the DATABASE clock (177)', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 12 }]])
    const total = await repository.countRecentMessages(32, 60)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('sender_participant_id = ?')
    expect(flat(sql)).toContain('created_at > NOW() - INTERVAL ? SECOND')
    expect(params).toEqual([32, 60])
    expect(total).toBe(12)
  })

  it('countUnread counts the OTHER side past the caller pointer (null pointer = 0)', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 2 }]])
    await repository.countUnread(3, 32, null)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('sender_participant_id <> ?')
    expect(flat(sql)).toContain('id > ?')
    expect(params).toEqual([3, 32, 0])
  })

  it('advanceLastRead only moves forward', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 1 }])
    await repository.advanceLastRead(32, 105)
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('last_read_message_id = ?')
    expect(flat(sql)).toContain('(last_read_message_id IS NULL OR last_read_message_id < ?)')
    expect(params).toEqual([105, 32, 105])
  })

  it('findReportForChat projects the guard columns and maps the flags', async () => {
    mockedPool.query.mockResolvedValue([
      [
        {
          id: 7,
          clientKey: 'k',
          reporterAccountId: null,
          category: 'assault',
          status: 'open',
          hidden: 'N',
          frozen: 'S',
          purged: 'N',
        },
      ],
    ])
    const report = await repository.findReportForChat(7)
    const [sql] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain("WHERE id = ? AND deleted = 'N'")
    expect(report).toEqual({
      id: 7,
      clientKey: 'k',
      reporterAccountId: null,
      category: 'assault',
      status: 'open',
      hidden: false,
      frozen: true,
      purged: false,
    })
  })
})
