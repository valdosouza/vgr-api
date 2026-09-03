import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/admin-audit/admin-audit.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { InterfaceKeys } from '@shared/acl/privileges'
import { AuditEntry, AuditListItem, AuditPage } from '@modules/admin-audit/admin-audit.interface'

jest.mock('@modules/admin-audit/admin-audit.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

function grant(keys: Record<string, boolean>): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey) => keys[interfaceKey] === true
  )
}

const item: AuditListItem = {
  id: 9,
  actorId: 3,
  actorName: 'Ana',
  action: 'grant',
  entity: 'user_privileges',
  entityId: '7',
  summary: { granted: ['reports'] },
  createdAt: '2026-08-20T10:00:00.000Z',
}
const page: AuditPage = { items: [item], page: 1, pageSize: 50, total: 1 }
const entry: AuditEntry = { ...item, ip: '203.0.113.5' }

describe('/api/admin-audit (B5 — decisions 116/165/166)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    token = signSession(3, 1)
  })

  it('the interface key is admin_audit (165)', () => {
    expect(InterfaceKeys.ADMIN_AUDIT).toBe('admin_audit')
  })

  describe('grant per route (72/165) — admin_audit VIEW; no other grant opens it', () => {
    it.each([['/api/admin-audit'], ['/api/admin-audit/facets'], ['/api/admin-audit/9']])(
      '401 without a token on %s',
      async (path) => {
        const res = await request(app).get(path)
        expect(res.status).toBe(401)
      }
    )

    it.each([['/api/admin-audit'], ['/api/admin-audit/facets'], ['/api/admin-audit/9']])(
      '403 FORBIDDEN with the reports and users grants but not admin_audit on %s',
      async (path) => {
        grant({ reports: true, users: true, report_stats: true })

        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(403)
        expect(res.body.code).toBe(ErrorCodes.FORBIDDEN)
        expect(mockedService.listAuditEntries).not.toHaveBeenCalled()
        expect(mockedService.getAuditEntry).not.toHaveBeenCalled()
        expect(mockedService.getAuditFacets).not.toHaveBeenCalled()
        expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
      }
    )
  })

  describe('GET /api/admin-audit — the list', () => {
    it('serves the page with defaults page=1 pageSize=50 and writes NO audit row (166)', async () => {
      grant({ admin_audit: true })
      mockedService.listAuditEntries.mockResolvedValue(page)

      const res = await request(app).get('/api/admin-audit').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(page)
      expect(mockedService.listAuditEntries).toHaveBeenCalledWith({ page: 1, pageSize: 50 })
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
      expect(mockedAudit.auditAdminAction).not.toHaveBeenCalled()
    })

    it('passes every filter, coerced, to the service', async () => {
      grant({ admin_audit: true })
      mockedService.listAuditEntries.mockResolvedValue(page)

      const res = await request(app)
        .get(
          '/api/admin-audit?page=2&pageSize=10&actorId=3&action=grant&entity=user_privileges&entityId=7&from=2026-08-01&to=2026-08-31T23:59:59Z'
        )
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(mockedService.listAuditEntries).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        actorId: 3,
        action: 'grant',
        entity: 'user_privileges',
        entityId: '7',
        from: '2026-08-01',
        to: '2026-08-31T23:59:59Z',
      })
    })

    it('the list body carries no ip on any item', async () => {
      grant({ admin_audit: true })
      mockedService.listAuditEntries.mockResolvedValue(page)

      const res = await request(app).get('/api/admin-audit').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      for (const served of res.body.items) expect(served).not.toHaveProperty('ip')
    })

    it('422 with field codes on a bad query (decision 83) — service never runs', async () => {
      grant({ admin_audit: true })

      const res = await request(app)
        .get('/api/admin-audit?page=0&pageSize=101&actorId=abc&action=hack&entity=&entityId=' + 'x'.repeat(41) + '&from=yesterday&to=2026-13-45T99:00:00Z')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      const fields = Object.fromEntries(res.body.fields.map((f: any) => [f.field, f.code]))
      expect(fields).toEqual({
        page: FieldErrorCodes.TOO_SHORT,
        pageSize: FieldErrorCodes.TOO_LONG,
        actorId: FieldErrorCodes.INVALID_VALUE,
        action: FieldErrorCodes.INVALID_OPTION,
        entity: FieldErrorCodes.TOO_SHORT,
        entityId: FieldErrorCodes.TOO_LONG,
        from: FieldErrorCodes.INVALID_FORMAT,
        to: FieldErrorCodes.INVALID_FORMAT,
      })
      expect(mockedService.listAuditEntries).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('every action of the AuditAction union is an accepted filter value', async () => {
      grant({ admin_audit: true })
      mockedService.listAuditEntries.mockResolvedValue(page)

      for (const action of ['create', 'update', 'delete', 'grant', 'state_change', 'read']) {
        const res = await request(app)
          .get(`/api/admin-audit?action=${action}`)
          .set('Authorization', `Bearer ${token}`)
        expect(res.status).toBe(200)
      }
    })
  })

  describe('GET /api/admin-audit/facets', () => {
    it('serves the distinct actions/entities, is NOT swallowed by /:id and writes NO audit row', async () => {
      grant({ admin_audit: true })
      mockedService.getAuditFacets.mockResolvedValue({ actions: ['grant', 'read'], entities: ['report', 'user'] })

      const res = await request(app).get('/api/admin-audit/facets').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ actions: ['grant', 'read'], entities: ['report', 'user'] })
      expect(mockedService.getAuditEntry).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/admin-audit/:id — the detail', () => {
    it('serves the entry WITH ip and writes NO audit row (166 — reading the trail is not audited)', async () => {
      grant({ admin_audit: true })
      mockedService.getAuditEntry.mockResolvedValue(entry)

      const res = await request(app).get('/api/admin-audit/9').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(entry)
      expect(res.body.ip).toBe('203.0.113.5')
      expect(mockedService.getAuditEntry).toHaveBeenCalledWith(9)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
      expect(mockedAudit.auditAdminAction).not.toHaveBeenCalled()
    })

    it('404 NOT_FOUND passes through the envelope', async () => {
      grant({ admin_audit: true })
      mockedService.getAuditEntry.mockRejectedValue(new HttpError(404, 'Audit entry not found', undefined, ErrorCodes.NOT_FOUND))

      const res = await request(app).get('/api/admin-audit/404').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(404)
      expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
    })

    it('400 INVALID_ID on a non-numeric id', async () => {
      grant({ admin_audit: true })

      const res = await request(app).get('/api/admin-audit/abc').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
      expect(mockedService.getAuditEntry).not.toHaveBeenCalled()
    })
  })

  describe('append-only (116): nothing writes through this module', () => {
    it.each([
      ['post', '/api/admin-audit'],
      ['put', '/api/admin-audit/9'],
      ['patch', '/api/admin-audit/9'],
      ['delete', '/api/admin-audit/9'],
    ])('%s %s does not exist (404) even with the grant', async (method, path) => {
      grant({ admin_audit: true })

      const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`).send({})

      expect(res.status).toBe(404)
      expect(mockedService.listAuditEntries).not.toHaveBeenCalled()
      expect(mockedService.getAuditEntry).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })
})
