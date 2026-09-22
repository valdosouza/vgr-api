import pool from '@shared/db/connection'
import * as repository from '@modules/users/user.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the team-user list under PS0 (decision 220). */
describe('user.repository — list paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without a window keeps the unpaged SELECT (legacy order, no password_hash, no LIMIT)', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listUsers(undefined, undefined)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toMatch(/FROM tb_user WHERE deleted = 'N' ORDER BY name, id$/)
    expect(flat(sql)).not.toContain('password_hash')
    expect(params).toEqual([])
  })

  it('with filter and window: LIKE on name OR email, LIMIT ? OFFSET ? parameterized', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listUsers('ana', { limit: 10, offset: 10 })

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain("WHERE deleted = 'N' AND (name LIKE ? OR email LIKE ?)")
    expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['%ana%', '%ana%', 10, 10])
  })

  it('counts the filtered users, soft-deleted excluded', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 5 }]])

    await expect(repository.countUsers('ana')).resolves.toBe(5)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "SELECT COUNT(*) AS total FROM tb_user WHERE deleted = 'N' AND (name LIKE ? OR email LIKE ?)"
    )
    expect(params).toEqual(['%ana%', '%ana%'])
  })
})
