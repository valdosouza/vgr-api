import pool from '@shared/db/connection'
import * as repository from '@modules/panic/responder-pool.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('responder-pool.repository — SQL contracts', () => {
  beforeEach(() => jest.resetAllMocks())

  it('findActiveMembers only returns approved members whose account still exists', async () => {
    // Found by the first manual end-to-end run (2026-09-06): a dangling
    // approved membership (user_id with no tb_user_account row) made the
    // recipient snapshot's FK fail and the whole panic trigger answer 500.
    mockedPool.query.mockResolvedValue([[{ id: 1, userId: 8, status: 'approved' }]])

    const rows = await repository.findActiveMembers()

    const sql = flat(mockedPool.query.mock.calls[0][0])
    expect(sql).toContain('FROM tb_responder_pool_membership m')
    expect(sql).toContain('JOIN tb_user_account a ON a.id = m.user_id')
    expect(sql).toContain("WHERE m.status = 'approved'")
    expect(rows).toEqual([{ id: 1, userId: 8, status: 'approved' }])
  })
})
