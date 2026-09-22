import pool from '@shared/db/connection'
import * as repository from '@modules/system-modules/system-module.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the menu-module list under PS0 (decision 220). */
describe('system-module.repository — list paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without a window keeps the unpaged SELECT (legacy order and no LIMIT)', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listSystemModules(undefined, undefined)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toMatch(/WHERE m\.deleted = 'N' ORDER BY m\.position, m\.id$/)
    expect(params).toEqual([])
  })

  it('with filter and window: LIKE on description, LIMIT ? OFFSET ? parameterized', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listSystemModules('adm', { limit: 10, offset: 10 })

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain("WHERE m.deleted = 'N' AND m.description LIKE ?")
    expect(flat(sql)).toMatch(/LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['%adm%', 10, 10])
  })

  it('counts the filtered modules without the interface sub-select', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 2 }]])

    await expect(repository.countSystemModules(undefined)).resolves.toBe(2)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe("SELECT COUNT(*) AS total FROM tb_module m WHERE m.deleted = 'N'")
    expect(params).toEqual([])
  })
})
