import pool from '@shared/db/connection'
import * as repository from '@modules/privileges/privilege.repository'
import { PAGE_SIZE_DEFAULT } from '@shared/http/paged-query'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the privilege list under PS0 (decision 220). */
describe('privilege.repository — list paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without a window keeps the unpaged SELECT (legacy)', async () => {
    mockedPool.query.mockResolvedValue([[{ id: 1, description: 'VIEW' }]])

    await repository.listPrivileges(undefined, undefined)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "SELECT id, description FROM tb_privilege WHERE deleted = 'N' ORDER BY id"
    )
    expect(params).toEqual([])
  })

  it('with filter and window: LIKE on description, LIMIT ? OFFSET ? parameterized', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listPrivileges('VIE', { limit: 10, offset: 10 })

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain("WHERE deleted = 'N' AND description LIKE ?")
    expect(flat(sql)).toMatch(/ORDER BY id LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['%VIE%', 10, 10])
  })

  it('counts the filtered rows, soft-deleted excluded', async () => {
    mockedPool.query.mockResolvedValue([[{ total: '7' }]])

    await expect(repository.countPrivileges('VIE')).resolves.toBe(7)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "SELECT COUNT(*) AS total FROM tb_privilege WHERE deleted = 'N' AND description LIKE ?"
    )
    expect(params).toEqual(['%VIE%'])
    expect(PAGE_SIZE_DEFAULT).toBe(20)
  })
})
