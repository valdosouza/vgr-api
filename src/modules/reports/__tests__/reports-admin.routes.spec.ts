import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/reports/reports-admin.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports-admin.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

/** Grant table per interface key — the stacked position guard needs both. */
function grant(keys: Record<string, boolean>): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey) => keys[interfaceKey] === true
  )
}

const emptyPage = { items: [], page: 1, pageSize: 20, total: 0 }

describe('/api/reports panel routes (B1 — decisions 159/160/165/166)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    grant({ reports: true })
    token = signSession(3, 1)
  })

  describe('GET /api/reports (list)', () => {
    it('lists with the reports VIEW grant and writes NO audit row (166)', async () => {
      mockedService.searchReports.mockResolvedValue(emptyPage)

      const res = await request(app)
        .get('/api/reports?status=open&tier=high&page=2&pageSize=5&frozen=true&from=2026-08-01')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(emptyPage)
      expect(mockedService.searchReports).toHaveBeenCalledWith({
        status: 'open',
        tier: 'high',
        page: 2,
        pageSize: 5,
        frozen: true,
        from: '2026-08-01',
      })
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('defaults page=1 pageSize=20 when the query is empty', async () => {
      mockedService.searchReports.mockResolvedValue(emptyPage)
      const res = await request(app).get('/api/reports').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(mockedService.searchReports).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    })

    it('422 with field codes on a bad query (decision 83) — service never runs', async () => {
      const res = await request(app)
        .get('/api/reports?page=0&pageSize=500&status=bogus&tier=extreme&frozen=maybe&from=yesterday&id=x')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      const fields = Object.fromEntries(res.body.fields.map((f: any) => [f.field, f.code]))
      expect(fields).toMatchObject({
        page: 'TOO_SHORT',
        pageSize: 'TOO_LONG',
        status: 'INVALID_OPTION',
        tier: 'INVALID_OPTION',
        frozen: 'INVALID_OPTION',
        from: 'INVALID_FORMAT',
        id: 'INVALID_VALUE',
      })
      expect(mockedService.searchReports).not.toHaveBeenCalled()
    })

    it('403 without the reports grant', async () => {
      grant({})
      const res = await request(app).get('/api/reports').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
      expect(mockedService.searchReports).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/reports/:id (detail)', () => {
    it('serves the detail and writes audit read/report/id (166)', async () => {
      mockedService.getReportPanelDetail.mockResolvedValue({ reportId: 7 } as any)

      const res = await request(app).get('/api/reports/7').set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reportId: 7 })
      expect(mockedService.getReportPanelDetail).toHaveBeenCalledWith(7)
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'read',
        'report',
        7
      )
    })

    it('404 envelope passes through and nothing is audited', async () => {
      mockedService.getReportPanelDetail.mockRejectedValue(
        new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const res = await request(app).get('/api/reports/7').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('400 on a non-numeric id', async () => {
      const res = await request(app).get('/api/reports/abc').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
    })

    it('403 without the reports grant — and no audit row', async () => {
      grant({})
      const res = await request(app).get('/api/reports/7').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
      expect(mockedService.getReportPanelDetail).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/reports/:id/position (exact — decision 159)', () => {
    it('needs the SECOND grant (report_exact_position) on top of reports', async () => {
      grant({ reports: true })
      const denied = await request(app)
        .get('/api/reports/7/position')
        .set('Authorization', `Bearer ${token}`)
      expect(denied.status).toBe(403)
      expect(mockedService.getReportExactPosition).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('the exact-position grant alone is not enough either (stacked)', async () => {
      grant({ report_exact_position: true })
      const denied = await request(app)
        .get('/api/reports/7/position')
        .set('Authorization', `Bearer ${token}`)
      expect(denied.status).toBe(403)
      expect(mockedService.getReportExactPosition).not.toHaveBeenCalled()
    })

    it('with both grants: exact position, audit read/report_position, no-store', async () => {
      grant({ reports: true, report_exact_position: true })
      mockedService.getReportExactPosition.mockResolvedValue({
        reportId: 7,
        lat: -23.551234,
        lng: -46.634567,
      })

      const res = await request(app)
        .get('/api/reports/7/position')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reportId: 7, lat: -23.551234, lng: -46.634567 })
      expect(res.headers['cache-control']).toBe('no-store')
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'read',
        'report_position',
        7
      )
    })

    it('404 (purged/missing) is not audited', async () => {
      grant({ reports: true, report_exact_position: true })
      mockedService.getReportExactPosition.mockRejectedValue(
        new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const res = await request(app)
        .get('/api/reports/7/position')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(404)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  it('no token is a 401 (panel plane, decision 119)', async () => {
    const res = await request(app).get('/api/reports')
    expect(res.status).toBe(401)
  })
})
