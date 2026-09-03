import pool from '@shared/db/connection'
import * as repository from '@modules/reports/reports.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
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
