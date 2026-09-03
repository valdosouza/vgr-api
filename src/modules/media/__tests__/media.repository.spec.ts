import pool from '@shared/db/connection'
import * as repository from '@modules/media/media.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

/** SQL contracts of the B2 block/unblock writes (decision 162): the
 *  status transition plus the four blocked_* columns — never the DEK
 *  (a hold preserves evidence, M3), never expires_at, never frozen. */
describe('media.repository — moderation SQL (decision 162)', () => {
  beforeEach(() => jest.resetAllMocks())

  function lastQuery(): [string, unknown[]] {
    const calls = mockedPool.query.mock.calls
    return calls[calls.length - 1] as unknown as [string, unknown[]]
  }

  it('blockMedia is an atomic available -> blocked transition stamping reason, note, NOW() and the actor', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)

    const transitioned = await repository.blockMedia(1, 'illegal_content', 'face of a minor', 3)

    expect(transitioned).toBe(true)
    const [sql, params] = lastQuery()
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain('UPDATE tb_media')
    expect(flat).toContain("status = 'blocked'")
    expect(flat).toContain('blocked_reason_code = ?')
    expect(flat).toContain('blocked_note = ?')
    expect(flat).toContain('blocked_at = NOW()')
    expect(flat).toContain('blocked_by = ?')
    expect(flat).toContain("WHERE id = ? AND status = 'available' AND deleted = 'N'")
    expect(params).toEqual(['illegal_content', 'face of a minor', 3, 1])
    expect(flat).not.toContain('dek_wrapped')
    expect(flat).not.toContain('expires_at')
    expect(flat).not.toContain('frozen')
    expect(mockedPool.query).toHaveBeenCalledTimes(1)
  })

  it('blockMedia reports a lost race as false', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 0 }, undefined] as any)
    expect(await repository.blockMedia(1, 'spam', null, 3)).toBe(false)
  })

  it('unblockMedia is an atomic blocked -> available transition clearing the four columns', async () => {
    mockedPool.query.mockResolvedValue([{ affectedRows: 1 }, undefined] as any)

    const transitioned = await repository.unblockMedia(1)

    expect(transitioned).toBe(true)
    const [sql, params] = lastQuery()
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain("status = 'available'")
    expect(flat).toContain('blocked_reason_code = NULL')
    expect(flat).toContain('blocked_note = NULL')
    expect(flat).toContain('blocked_at = NULL')
    expect(flat).toContain('blocked_by = NULL')
    expect(flat).toContain("WHERE id = ? AND status = 'blocked' AND deleted = 'N'")
    expect(params).toEqual([1])
    expect(flat).not.toContain('dek_wrapped')
    expect(flat).not.toContain('expires_at')
    expect(flat).not.toContain('frozen')
  })

  it('findByPublicId projects the blocked_* columns into the row', async () => {
    const at = new Date('2026-09-02T10:00:00Z')
    mockedPool.query.mockResolvedValue([
      [
        {
          id: 1,
          publicId: 'p1',
          class: 'evidence',
          uploaderAccountId: null,
          status: 'blocked',
          mimeOriginal: 'image/jpeg',
          mime: 'image/webp',
          bytesOriginal: 1,
          bytes: 1,
          width: 1,
          height: 1,
          sha256Original: 'a',
          sha256: 'b',
          storagePrefix: 'p',
          keepOriginal: 'N',
          exifWarningVersion: null,
          dekWrapped: 'w',
          expiresAt: null,
          frozen: 'N',
          blockedReasonCode: 'abuse',
          blockedNote: 'n',
          blockedAt: at,
          blockedBy: 3,
        },
      ],
      undefined,
    ] as any)

    const row = await repository.findByPublicId('p1')

    const [sql] = lastQuery()
    expect(sql.replace(/\s+/g, ' ')).toContain('blocked_reason_code AS blockedReasonCode')
    expect(row).toMatchObject({
      status: 'blocked',
      blockedReasonCode: 'abuse',
      blockedNote: 'n',
      blockedAt: at,
      blockedBy: 3,
    })
  })

  it('the expiry job still skips frozen rows and shreds ONLY due ones — blocked is not a selector (unchanged)', async () => {
    mockedPool.query.mockResolvedValue([[], undefined] as any)
    await repository.findExpired(10, 48)
    const [sql] = lastQuery()
    const flat = sql.replace(/\s+/g, ' ')
    expect(flat).toContain("frozen = 'N'")
    expect(flat).not.toContain("'blocked'")
  })
})
