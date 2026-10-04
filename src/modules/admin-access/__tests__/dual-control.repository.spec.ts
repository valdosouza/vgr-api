import pool from '@shared/db/connection'
import * as repository from '@modules/admin-access/dual-control.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as unknown as { query: jest.Mock }

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** SQL contracts of the dual-control gate after round 18 (decisions 223–227). */
describe('dual-control.repository', () => {
  beforeEach(() => jest.resetAllMocks())

  it('stores the requester id with a pending request — no approver list any more', async () => {
    mockedPool.query.mockResolvedValue([{ insertId: 5 }])

    await expect(repository.createRequest(99, 'Court order #123', 7)).resolves.toBe(5)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "INSERT INTO tb_dual_control_access_request (accountability_log_entry_id, legal_basis, requested_by, status) VALUES (?, ?, ?, 'pending')"
    )
    expect(params).toEqual([99, 'Court order #123', 7])
  })

  it('grants with a conditional write on status = pending and reports whether it won (224)', async () => {
    mockedPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 0 }])

    await expect(repository.grantRequest(1, 8)).resolves.toBe(true)
    await expect(repository.grantRequest(1, 9)).resolves.toBe(false)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe(
      "UPDATE tb_dual_control_access_request SET status = 'granted', approved_by = ?, approved_at = NOW() WHERE id = ? AND status = 'pending'"
    )
    expect(params).toEqual([8, 1])
  })

  it('checks the accountability entry exists without reading its content (226)', async () => {
    mockedPool.query.mockResolvedValueOnce([[{ 1: 1 }]]).mockResolvedValueOnce([[]])

    await expect(repository.accountabilityEntryExists(1)).resolves.toBe(true)
    await expect(repository.accountabilityEntryExists(2)).resolves.toBe(false)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe('SELECT 1 FROM tb_accountability_log WHERE id = ? LIMIT 1')
    expect(params).toEqual([1])
  })

  it('lists newest first with requester and approver NAMES, never e-mail (227)', async () => {
    mockedPool.query.mockResolvedValue([
      [
        {
          id: 1,
          accountabilityLogEntryId: 99,
          legalBasis: 'Court order #123',
          status: 'granted',
          requestedBy: 7,
          requestedByName: 'Ana',
          approvedBy: 8,
          approvedByName: 'Bia',
          approvedAt: new Date('2026-01-02'),
          createdAt: new Date('2026-01-01'),
        },
      ],
    ])

    const rows = await repository.listRequests(undefined, undefined)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toContain('LEFT JOIN tb_user ru ON ru.id = r.requested_by')
    expect(flat(sql)).toContain('LEFT JOIN tb_user au ON au.id = r.approved_by')
    expect(flat(sql)).toContain('ru.name AS requestedByName')
    expect(flat(sql)).not.toContain('email')
    expect(flat(sql)).toMatch(/ORDER BY r\.created_at DESC, r\.id DESC$/)
    expect(params).toEqual([])
    expect(rows[0]).toMatchObject({ requestedByName: 'Ana', approvedByName: 'Bia', status: 'granted' })
  })

  it('maps a voided pre-round-18 request with no requester to nulls (225)', async () => {
    mockedPool.query.mockResolvedValue([
      [{ id: 2, accountabilityLogEntryId: 1, legalBasis: 'x', status: 'void', createdAt: new Date('2026-01-01') }],
    ])

    const row = await repository.findRequestById(2)

    expect(row).toMatchObject({ status: 'void', requestedBy: null, requestedByName: null, approvedBy: null, approvedAt: null })
    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toMatch(/WHERE r\.id = \?$/)
    expect(params).toEqual([2])
  })

  it('with filter and window: LIKE on the legal basis, LIMIT ? OFFSET ? parameterized (220)', async () => {
    mockedPool.query.mockResolvedValue([[]])

    await repository.listRequests('Court', { limit: 20, offset: 40 })

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toMatch(/WHERE r\.legal_basis LIKE \? ORDER BY r\.created_at DESC, r\.id DESC LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['%Court%', 20, 40])
  })

  it('counts the filtered requests', async () => {
    mockedPool.query.mockResolvedValue([[{ total: '3' }]])

    await expect(repository.countRequests('Court')).resolves.toBe(3)

    const [sql, params] = mockedPool.query.mock.calls[0]
    expect(flat(sql)).toBe('SELECT COUNT(*) AS total FROM tb_dual_control_access_request r WHERE r.legal_basis LIKE ?')
    expect(params).toEqual(['%Court%'])
  })
})
