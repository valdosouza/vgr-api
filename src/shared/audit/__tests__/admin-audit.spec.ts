import { Request } from 'express'
import pool from '@shared/db/connection'
import { auditAdminAction, auditFromRequest } from '@shared/audit/admin-audit'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

describe('admin-audit (decision 116)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedPool.query.mockResolvedValue([{}, undefined] as any)
  })

  it('records actor, action, entity, id, summary and ip', async () => {
    auditAdminAction({
      actorId: 7,
      action: 'grant',
      entity: 'user_privileges',
      entityId: 3,
      summary: { interfaceId: 9, privilegeIds: [1, 2] },
      ip: '10.0.0.1',
    })
    await new Promise(process.nextTick)

    const [sql, params] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO tb_admin_audit')
    expect(params).toEqual([
      7,
      'grant',
      'user_privileges',
      '3',
      JSON.stringify({ interfaceId: 9, privilegeIds: [1, 2] }),
      '10.0.0.1',
    ])
  })

  it('redacts secret-looking fields — no password ever reaches a log (decision 110)', async () => {
    auditAdminAction({
      actorId: 7,
      action: 'create',
      entity: 'user',
      entityId: 3,
      summary: { name: 'Ana', password: 'super-secret-pass', nested: { apiToken: 'x' } },
    })
    await new Promise(process.nextTick)

    const [, params] = mockedPool.query.mock.calls[0] as unknown as [string, unknown[]]
    const summary = params[4] as string
    expect(summary).not.toContain('super-secret-pass')
    expect(JSON.parse(summary)).toEqual({
      name: 'Ana',
      password: '[redacted]',
      nested: { apiToken: '[redacted]' },
    })
  })

  it('never throws when the write fails — fire-and-forget', async () => {
    mockedPool.query.mockRejectedValue(new Error('db down'))

    expect(() =>
      auditAdminAction({ actorId: 7, action: 'delete', entity: 'user', entityId: 1 })
    ).not.toThrow()
    await new Promise(process.nextTick)
  })

  it('auditFromRequest is a no-op without an authenticated user', () => {
    auditFromRequest({ user: undefined, ip: '1.1.1.1' } as unknown as Request, 'update', 'user', 1)
    expect(mockedPool.query).not.toHaveBeenCalled()
  })
})
