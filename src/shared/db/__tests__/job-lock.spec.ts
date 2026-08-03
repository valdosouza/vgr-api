import pool from '@shared/db/connection'
import { withJobLock } from '@shared/db/job-lock'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { getConnection: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

function connection(locked: 0 | 1) {
  const query = jest
    .fn()
    .mockResolvedValueOnce([[{ locked }]]) // GET_LOCK
    .mockResolvedValue([[]]) // RELEASE_LOCK
  const release = jest.fn()
  return { query, release }
}

describe('withJobLock (decision 90 — single-instance scheduled jobs)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('runs the job and releases lock + connection', async () => {
    const conn = connection(1)
    ;(mockedPool.getConnection as jest.Mock).mockResolvedValue(conn)

    const result = await withJobLock('vgr:test', async () => 'done')

    expect(result).toBe('done')
    expect(conn.query).toHaveBeenCalledWith('SELECT GET_LOCK(?, 0) AS locked', ['vgr:test'])
    expect(conn.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['vgr:test'])
    expect(conn.release).toHaveBeenCalled()
  })

  it('returns null without running when another instance holds the lock', async () => {
    const conn = connection(0)
    ;(mockedPool.getConnection as jest.Mock).mockResolvedValue(conn)
    const job = jest.fn()

    expect(await withJobLock('vgr:test', job)).toBeNull()
    expect(job).not.toHaveBeenCalled()
    // No RELEASE_LOCK for a lock we never got — but the connection returns.
    expect(conn.query).toHaveBeenCalledTimes(1)
    expect(conn.release).toHaveBeenCalled()
  })

  it('releases lock and connection even when the job throws', async () => {
    const conn = connection(1)
    ;(mockedPool.getConnection as jest.Mock).mockResolvedValue(conn)

    await expect(
      withJobLock('vgr:test', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(conn.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['vgr:test'])
    expect(conn.release).toHaveBeenCalled()
  })
})
