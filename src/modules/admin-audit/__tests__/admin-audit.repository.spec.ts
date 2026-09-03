import pool from '@shared/db/connection'
import * as repository from '@modules/admin-audit/admin-audit.repository'

jest.mock('@shared/db/connection', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}))

const mockedPool = pool as jest.Mocked<typeof pool>

const FROM = new Date('2026-08-01T00:00:00.000Z')
const TO = new Date('2026-09-01T00:00:00.000Z')

function queryAt(index: number): [string, unknown[]] {
  const [sql, params] = mockedPool.query.mock.calls[index] as unknown as [string, unknown[]]
  return [sql.replace(/\s+/g, ' '), params]
}

function everySql(): string[] {
  return mockedPool.query.mock.calls.map((call) => String(call[0]).replace(/\s+/g, ' ').toUpperCase())
}

/** SQL contracts of the audit trail READ (B5 — decisions 116/165/166):
 *  SELECT only, the actor's name by LEFT JOIN on tb_user (a deleted user
 *  keeps naming its rows), `ip` in the single-entry projection ONLY. */
describe('admin-audit.repository — read-only SQL (decision 116)', () => {
  beforeEach(() => jest.resetAllMocks())

  describe('listAuditEntries', () => {
    it('counts first, then selects with the actor name via LEFT JOIN, newest first, paginated', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: '2' }], undefined] as any)
        .mockResolvedValueOnce([
          [
            {
              id: 9,
              actorId: 3,
              actorName: 'Ana',
              action: 'grant',
              entity: 'user_privileges',
              entityId: '7',
              summary: '{"granted":["reports"]}',
              createdAt: new Date('2026-08-20T10:00:00.000Z'),
            },
            {
              id: 8,
              actorId: 4,
              actorName: null,
              action: 'read',
              entity: 'report',
              entityId: null,
              summary: null,
              createdAt: new Date('2026-08-19T10:00:00.000Z'),
            },
          ],
          undefined,
        ] as any)

      const result = await repository.listAuditEntries({}, 2, 25)

      const [countSql, countParams] = queryAt(0)
      expect(countSql).toContain('SELECT COUNT(*) AS total FROM tb_admin_audit a')
      expect(countSql).not.toContain('WHERE')
      expect(countParams).toEqual([])

      const [sql, params] = queryAt(1)
      expect(sql).toContain('FROM tb_admin_audit a')
      expect(sql).toContain('LEFT JOIN tb_user u ON u.id = a.actor_id')
      expect(sql).toContain('u.name AS actorName')
      expect(sql).toContain('ORDER BY a.created_at DESC, a.id DESC')
      expect(sql).toContain('LIMIT ? OFFSET ?')
      expect(params).toEqual([25, 25])
      expect(result.total).toBe(2)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual({
        id: 9,
        actorId: 3,
        actorName: 'Ana',
        action: 'grant',
        entity: 'user_privileges',
        entityId: '7',
        summary: '{"granted":["reports"]}',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
      })
    })

    it('the list projection NEVER selects the ip (personal data — detail only)', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.listAuditEntries({}, 1, 50)

      const [sql] = queryAt(1)
      expect(sql).not.toMatch(/\bip\b/i)
    })

    it('the LEFT JOIN does not filter deleted users — the trail keeps its actor', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.listAuditEntries({}, 1, 50)

      const [sql] = queryAt(1)
      expect(sql).not.toContain('u.deleted')
      expect(sql).not.toContain('u.active')
    })

    it('short-circuits on total 0 without running the SELECT', async () => {
      mockedPool.query.mockResolvedValueOnce([[{ total: 0 }], undefined] as any)

      const result = await repository.listAuditEntries({}, 1, 50)

      expect(result).toEqual({ rows: [], total: 0 })
      expect(mockedPool.query).toHaveBeenCalledTimes(1)
    })

    it('applies every filter as a parameterized clause on the same WHERE for count and select', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.listAuditEntries(
        {
          actorId: 3,
          action: 'grant',
          entity: 'user_privileges',
          entityId: '7',
          createdFrom: FROM,
          createdTo: TO,
          createdToExclusive: true,
        },
        1,
        50
      )

      const [countSql, countParams] = queryAt(0)
      const [sql, params] = queryAt(1)
      for (const clause of [
        'a.actor_id = ?',
        'a.action = ?',
        'a.entity = ?',
        'a.entity_id = ?',
        'a.created_at >= ?',
        'a.created_at < ?',
      ]) {
        expect(countSql).toContain(clause)
        expect(sql).toContain(clause)
      }
      expect(countParams).toEqual([3, 'grant', 'user_privileges', '7', FROM, TO])
      expect(params).toEqual([3, 'grant', 'user_privileges', '7', FROM, TO, 50, 0])
    })

    it('an inclusive `to` compares with <=', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.listAuditEntries({ createdTo: TO, createdToExclusive: false }, 1, 50)

      const [sql, params] = queryAt(1)
      expect(sql).toContain('a.created_at <= ?')
      expect(sql).not.toContain('a.created_at < ?')
      expect(params).toEqual([TO, 50, 0])
    })
  })

  describe('findAuditEntryById', () => {
    it('selects the full row INCLUDING ip, with the actor name, by primary key', async () => {
      const createdAt = new Date('2026-08-20T10:00:00.000Z')
      mockedPool.query.mockResolvedValueOnce([
        [
          {
            id: 9,
            actorId: 3,
            actorName: 'Ana',
            action: 'grant',
            entity: 'user_privileges',
            entityId: '7',
            summary: '{"granted":["reports"]}',
            ip: '203.0.113.5',
            createdAt,
          },
        ],
        undefined,
      ] as any)

      const row = await repository.findAuditEntryById(9)

      const [sql, params] = queryAt(0)
      expect(sql).toContain('a.ip')
      expect(sql).toContain('LEFT JOIN tb_user u ON u.id = a.actor_id')
      expect(sql).toContain('WHERE a.id = ?')
      expect(params).toEqual([9])
      expect(row).toEqual({
        id: 9,
        actorId: 3,
        actorName: 'Ana',
        action: 'grant',
        entity: 'user_privileges',
        entityId: '7',
        summary: '{"granted":["reports"]}',
        ip: '203.0.113.5',
        createdAt,
      })
    })

    it('returns null when the id does not exist', async () => {
      mockedPool.query.mockResolvedValueOnce([[], undefined] as any)
      expect(await repository.findAuditEntryById(404)).toBeNull()
    })
  })

  describe('listAuditFacets', () => {
    it('serves the DISTINCT actions and entities present in the table, sorted', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ action: 'grant' }, { action: 'read' }], undefined] as any)
        .mockResolvedValueOnce([[{ entity: 'report' }, { entity: 'user' }], undefined] as any)

      const facets = await repository.listAuditFacets()

      const [actionsSql] = queryAt(0)
      const [entitiesSql] = queryAt(1)
      expect(actionsSql).toContain('SELECT DISTINCT action FROM tb_admin_audit')
      expect(actionsSql).toContain('ORDER BY action')
      expect(entitiesSql).toContain('SELECT DISTINCT entity FROM tb_admin_audit')
      expect(entitiesSql).toContain('ORDER BY entity')
      expect(facets).toEqual({ actions: ['grant', 'read'], entities: ['report', 'user'] })
    })
  })

  describe('append-only (decision 116)', () => {
    it('no statement issued by this repository is anything but a SELECT', async () => {
      mockedPool.query
        .mockResolvedValueOnce([[{ total: 1 }], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)
        .mockResolvedValueOnce([[], undefined] as any)

      await repository.listAuditEntries({ actorId: 1 }, 1, 10)
      await repository.findAuditEntryById(1)
      await repository.listAuditFacets()

      for (const sql of everySql()) {
        expect(sql.trim().startsWith('SELECT')).toBe(true)
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/)
      }
    })

    it('exposes only read functions', () => {
      expect(Object.keys(repository).sort()).toEqual([
        'findAuditEntryById',
        'listAuditEntries',
        'listAuditFacets',
      ])
    })
  })
})
