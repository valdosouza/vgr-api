import pool from '@shared/db/connection'
import * as repository from '@modules/reports/reports.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn(), getConnection: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

/** SQL contracts of the B2 moderation writes (decisions 162/167): the
 *  hide/unhide statements touch the five hidden_* columns and NOTHING
 *  else — not the retention clock, not the freeze, not the timeline. */
describe('reports.repository — moderation SQL (decisions 162/167)', () => {
  beforeEach(() => jest.resetAllMocks())

  function lastQuery(): [string, unknown[]] {
    const calls = mockedPool.query.mock.calls
    return calls[calls.length - 1] as unknown as [string, unknown[]]
  }

  it('hideReport is an atomic hidden=N -> S transition stamping reason, note, NOW() and the actor', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)

    const transitioned = await repository.hideReport(7, 'spam', 'copy of #5', 3)

    expect(transitioned).toBe(true)
    const [sql, params] = lastQuery()
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain('UPDATE tb_report')
    expect(flat).toContain("hidden = 'S'")
    expect(flat).toContain('hidden_reason_code = ?')
    expect(flat).toContain('hidden_note = ?')
    expect(flat).toContain('hidden_at = NOW()')
    expect(flat).toContain('hidden_by = ?')
    expect(flat).toContain("WHERE id = ? AND hidden = 'N' AND deleted = 'N'")
    expect(params).toEqual(['spam', 'copy of #5', 3, 7])
    // Retention and freeze are not moderation's (162): never in the SET.
    expect(flat).not.toContain('expires_at')
    expect(flat).not.toContain('frozen')
    expect(flat).not.toContain('status')
    expect(flat).not.toContain('tb_report_timeline')
    expect(mockedPool.query).toHaveBeenCalledTimes(1)
  })

  it('hideReport reports a lost race as false (0 rows)', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 0 }, undefined] as any)
    expect(await repository.hideReport(7, 'spam', null, 3)).toBe(false)
  })

  it('unhideReport clears the five columns atomically from hidden=S', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)

    const transitioned = await repository.unhideReport(7)

    expect(transitioned).toBe(true)
    const [sql, params] = lastQuery()
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain("hidden = 'N'")
    expect(flat).toContain('hidden_reason_code = NULL')
    expect(flat).toContain('hidden_note = NULL')
    expect(flat).toContain('hidden_at = NULL')
    expect(flat).toContain('hidden_by = NULL')
    expect(flat).toContain("WHERE id = ? AND hidden = 'S'")
    expect(params).toEqual([7])
    expect(flat).not.toContain('expires_at')
    expect(flat).not.toContain('frozen')
    expect(mockedPool.query).toHaveBeenCalledTimes(1)
  })

  it('findById projects the hidden_* columns into the row', async () => {
    mockedPool.query.mockResolvedValue([
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
          hidden: 'S',
          hiddenReasonCode: 'spam',
          hiddenNote: null,
          hiddenAt: new Date('2026-09-02T10:00:00Z'),
          hiddenBy: 3,
          createdAt: new Date('2026-08-03T12:00:00Z'),
        },
      ],
      undefined,
    ] as any)

    const row = await repository.findById(7)

    const [sql] = lastQuery()
    expect(sql.replace(/\s+/g, ' ')).toContain('hidden_reason_code AS hiddenReasonCode')
    expect(row).toMatchObject({
      hidden: true,
      hiddenReasonCode: 'spam',
      hiddenNote: null,
      hiddenAt: new Date('2026-09-02T10:00:00Z'),
      hiddenBy: 3,
    })
  })

  it('searchReports filters on hidden and projects it', async () => {
    mockedPool.query
      .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
      .mockResolvedValueOnce([
        [
          {
            id: 7,
            category: 'assault',
            freeTag: null,
            subject: 'adult',
            anonymous: 'N',
            status: 'open',
            frozen: 'N',
            purged: 'N',
            hidden: 'S',
            lat: '-23.5',
            lng: '-46.6',
            createdAt: new Date(),
            resolvedAt: null,
            mediaCount: 0,
          },
        ],
        undefined,
      ] as any)

    const { rows } = await repository.searchReports({ hidden: true }, 1, 20)

    const [countSql, countParams] = mockedPool.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ]
    expect(countSql).toContain('r.hidden = ?')
    expect(countParams).toContain('S')
    expect(rows[0].hidden).toBe(true)
  })

  it('findAttachedMediaWithStatus carries the block reason for the panel', async () => {
    const at = new Date('2026-09-02T10:00:00Z')
    mockedPool.query.mockResolvedValue([
      [
        {
          publicId: 'p1',
          mime: 'image/webp',
          width: 1,
          height: 1,
          status: 'blocked',
          blockedReasonCode: 'abuse',
          blockedNote: 'n',
          blockedAt: at,
        },
      ],
      undefined,
    ] as any)

    const media = await repository.findAttachedMediaWithStatus(7)

    const [sql] = lastQuery()
    expect(sql.replace(/\s+/g, ' ')).toContain('m.blocked_reason_code AS blockedReasonCode')
    expect(media).toEqual([
      {
        publicId: 'p1',
        mime: 'image/webp',
        width: 1,
        height: 1,
        status: 'blocked',
        blockedReasonCode: 'abuse',
        blockedNote: 'n',
        blockedAt: at,
      },
    ])
  })

  it('listAttachedMedia (owner/participant/public lists) serves ONLY available media — blocked excluded', async () => {
    mockedPool.query.mockResolvedValue([[], undefined] as any)
    await repository.listAttachedMedia(7)
    const [sql] = lastQuery()
    expect(sql.replace(/\s+/g, ' ')).toContain("m.status = 'available'")
  })
})

/** Purge propagation to the chat (C1, decision 173/131): one transaction
 *  nulls the report payload, the timeline payloads AND the chat text,
 *  keeping every row as the statistical skeleton. */
describe('reports.repository — purge reaches the chat (decisions 131/173)', () => {
  const mockedGetConnection = (pool as any).getConnection as jest.Mock

  beforeEach(() => jest.resetAllMocks())

  it('purgeReport nulls chat text and marks purged in the SAME transaction as the report', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    }
    mockedGetConnection.mockResolvedValue(conn)

    await repository.purgeReport(7)

    expect(conn.beginTransaction).toHaveBeenCalled()
    const statements = conn.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '))
    expect(statements.some((s) => s.includes('UPDATE tb_report ') && s.includes("purged = 'S'"))).toBe(true)
    expect(statements.some((s) => s.includes('UPDATE tb_report_timeline SET payload = NULL'))).toBe(true)
    const chat = statements.find((s) => s.includes('tb_chat_message'))
    expect(chat).toBeDefined()
    expect(chat).toContain('text = NULL')
    expect(chat).toContain("purged = 'S'")
    expect(chat).toContain('tb_chat_thread')
    expect(chat).not.toMatch(/DELETE/i)
    expect(conn.commit).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
    expect(mockedPool.query).not.toHaveBeenCalled()
  })

  it('a failure inside the purge rolls everything back', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      query: jest.fn().mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error('boom')),
    }
    mockedGetConnection.mockResolvedValue(conn)
    await expect(repository.purgeReport(7)).rejects.toThrow('boom')
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })

  it('getOwnerChatSummary counts threads and the unread messages past the REPORTER pointer', async () => {
    mockedPool.query
      .mockResolvedValueOnce([[{ total: 2 }], undefined] as any)
      .mockResolvedValueOnce([[{ total: 5 }], undefined] as any)

    const summary = await repository.getOwnerChatSummary(7)

    expect(summary).toEqual({ threads: 2, unread: 5 })
    const [threadsSql, threadsParams] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(threadsSql.replace(/\s+/g, ' ')).toContain("FROM tb_chat_thread WHERE tb_report_id = ? AND deleted = 'N'")
    expect(threadsParams).toEqual([7])
    const [unreadSql] = mockedPool.query.mock.calls[1] as unknown as [string, unknown[]]
    const flat = unreadSql.replace(/\s+/g, ' ')
    expect(flat).toContain("p.role = 'reporter'")
    expect(flat).toContain('m.sender_participant_id <> p.id')
    expect(flat).toContain('p.last_read_message_id IS NULL OR m.id > p.last_read_message_id')
  })

  it('getHelperChatSummary returns the helper thread and their unread, or null without a thread', async () => {
    mockedPool.query.mockResolvedValueOnce([[{ threadId: 3, unread: 1 }], undefined] as any)
    expect(await repository.getHelperChatSummary(7, 8)).toEqual({ threadId: 3, unread: 1 })
    const [sql, params] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain("p.role = 'helper'")
    expect(flat).toContain('t.helper_account_id = ?')
    expect(params).toEqual([7, 8])

    mockedPool.query.mockResolvedValueOnce([[], undefined] as any)
    expect(await repository.getHelperChatSummary(7, 8)).toBeNull()
  })
})

/** RT1 (decision 187): the rating is reputation, not evidence — the purge
 *  never reaches tb_helper_rating; and the offer row it hangs on (FK) is
 *  never deleted either (18 keeps offers linked). */
describe('reports.repository — purge preserves ratings (decision 187)', () => {
  const mockedGetConnection = (pool as any).getConnection as jest.Mock

  beforeEach(() => jest.resetAllMocks())

  it('purgeReport touches neither tb_helper_rating nor tb_help_offer, and never DELETEs', async () => {
    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    }
    mockedGetConnection.mockResolvedValue(conn)

    await repository.purgeReport(7)

    const statements = conn.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '))
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      expect(statement).not.toContain('tb_helper_rating')
      expect(statement).not.toContain('tb_help_offer')
      expect(statement).not.toMatch(/DELETE/i)
    }
    expect(mockedPool.query).not.toHaveBeenCalled()
  })
})

/** RT1: the owner's offers list carries the rating facet through ONE
 *  query — a LEFT JOIN on tb_helper_rating (table access, never a module
 *  import), the mechanism of the chat summaries (C1). */
describe('reports.repository — findOffersWithNames carries the rating (RT1, decisions 180/183)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('LEFT JOINs the living rating of each offer and projects helperAccountId + ratingScore', async () => {
    mockedPool.query.mockResolvedValueOnce([
      [
        {
          id: 1,
          helpType: 'share',
          anonymous: 'S',
          helperAccountId: 8,
          helperDisplayName: 'Ana',
          createdAt: new Date('2026-08-03T15:00:00Z'),
          ratingScore: 4,
        },
        {
          id: 2,
          helpType: 'share',
          anonymous: 'N',
          helperAccountId: null,
          helperDisplayName: null,
          createdAt: new Date('2026-08-03T15:01:00Z'),
          ratingScore: null,
        },
      ],
      undefined,
    ] as any)

    const rows = await repository.findOffersWithNames(7)

    const [sql, params] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toMatch(
      /LEFT JOIN tb_helper_rating \w+ ON \w+\.tb_help_offer_id = o\.id AND \w+\.deleted = 'N'/
    )
    expect(flat).toContain('o.helper_account_id AS helperAccountId')
    expect(flat).toContain("o.tb_report_id = ? AND o.deleted = 'N'")
    expect(params).toEqual([7])
    expect(rows).toEqual([
      {
        id: 1,
        helpType: 'share',
        anonymous: true,
        helperAccountId: 8,
        helperDisplayName: 'Ana',
        createdAt: new Date('2026-08-03T15:00:00Z'),
        ratingScore: 4,
      },
      {
        id: 2,
        helpType: 'share',
        anonymous: false,
        helperAccountId: null,
        helperDisplayName: null,
        createdAt: new Date('2026-08-03T15:01:00Z'),
        ratingScore: null,
      },
    ])
  })
})
