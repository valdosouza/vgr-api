import pool from '@shared/db/connection'
import * as repository from '@modules/interfaces/interface.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the interface (screen) list under PS0 (decision 220). */
describe('interface.repository — list paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without a window keeps the unpaged SELECT (legacy order and no LIMIT)', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listInterfaces(undefined, undefined)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toMatch(/WHERE i\.deleted = 'N' ORDER BY i\.group_default, i\.position, i\.id$/)
    expect(flat(sql)).not.toContain('LIMIT')
    expect(params).toEqual([])
  })

  it('with filter and window: LIKE on description OR i18n_key, LIMIT ? OFFSET ? parameterized', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listInterfaces('rep', { limit: 10, offset: 10 })

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain("WHERE i.deleted = 'N' AND (i.description LIKE ? OR i.i18n_key LIKE ?)")
    expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['%rep%', '%rep%', 10, 10])
  })

  it('counts the filtered screens without the privilege sub-select', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 3 }]])

    await expect(repository.countInterfaces('rep')).resolves.toBe(3)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "SELECT COUNT(*) AS total FROM tb_interface i WHERE i.deleted = 'N' AND (i.description LIKE ? OR i.i18n_key LIKE ?)"
    )
    expect(params).toEqual(['%rep%', '%rep%'])
  })
})
