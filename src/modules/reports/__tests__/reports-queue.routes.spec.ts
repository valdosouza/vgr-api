import request from 'supertest'
import app from '../../../app'
import * as queueService from '@modules/reports/reports-queue.service'
import * as adminService from '@modules/reports/reports-admin.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'
import { QueuePage } from '@modules/reports/reports.interface'

jest.mock('@modules/reports/reports-queue.service')
jest.mock('@modules/reports/reports-admin.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedQueue = queueService as jest.Mocked<typeof queueService>
const mockedAdmin = adminService as jest.Mocked<typeof adminService>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

const USER_ID = 3

/** Grants by "interface:privilege" — the queue reads with reports:VIEW,
 *  reviewing needs reports:UPDATE (165 — no new interface). */
function grant(pairs: string[]): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey, privilege) => pairs.includes(`${interfaceKey}:${privilege}`)
  )
}

const sample: QueuePage = {
  items: [
    {
      reportId: 7,
      category: 'missing',
      freeTag: null,
      subject: 'child',
      tier: 'high',
      status: 'open',
      anonymous: true,
      frozen: false,
      purged: false,
      hidden: false,
      reviewed: false,
      mediaCount: 2,
      position: { lat: -23.55, lng: -46.63 },
      createdAt: '2026-09-02T03:30:00.000Z',
      resolvedAt: null,
      priority: 'high',
      hasMedia: true,
      ageHours: 12,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
}

describe('/api/reports/queue and /api/reports/:id/reviewed (B3 — decisions 161/165/166)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    token = signSession(USER_ID, 1)
    mockedQueue.getModerationQueue.mockResolvedValue(sample)
    mockedQueue.markReviewed.mockResolvedValue({ reportId: 7, reviewedBy: USER_ID } as any)
  })

  describe('GET /api/reports/queue', () => {
    it('serves the queue with the reports VIEW grant and writes NO audit row (166 — a list read)', async () => {
      grant(['reports:VIEW'])

      const res = await request(app)
        .get('/api/reports/queue?page=2&pageSize=5')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(sample)
      expect(mockedQueue.getModerationQueue).toHaveBeenCalledWith({ page: 2, pageSize: 5 })
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('defaults page=1 pageSize=20', async () => {
      grant(['reports:VIEW'])
      await request(app).get('/api/reports/queue').set('Authorization', `Bearer ${token}`)
      expect(mockedQueue.getModerationQueue).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    })

    it('is NOT swallowed by /:id — the detail handler never runs (no 400 INVALID_ID, no audit)', async () => {
      grant(['reports:VIEW'])
      const res = await request(app).get('/api/reports/queue').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
      expect(mockedAdmin.getReportPanelDetail).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('422 with field codes on a bad query (decision 83) — service never runs', async () => {
      grant(['reports:VIEW'])

      const res = await request(app)
        .get('/api/reports/queue?page=0&pageSize=101')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      const fields = Object.fromEntries(res.body.fields.map((f: any) => [f.field, f.code]))
      expect(fields).toEqual({
        page: FieldErrorCodes.TOO_SHORT,
        pageSize: FieldErrorCodes.TOO_LONG,
      })
      expect(mockedQueue.getModerationQueue).not.toHaveBeenCalled()

      const nan = await request(app)
        .get('/api/reports/queue?page=abc')
        .set('Authorization', `Bearer ${token}`)
      expect(nan.status).toBe(422)
    })

    it('403 without the reports grant — UPDATE alone does not read', async () => {
      grant(['report_stats:VIEW', 'case_freeze:UPDATE'])
      const res = await request(app).get('/api/reports/queue').set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
      expect(mockedQueue.getModerationQueue).not.toHaveBeenCalled()
    })

    it('401 without a token', async () => {
      const res = await request(app).get('/api/reports/queue')
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/reports/:id/reviewed', () => {
    it('marks reviewed with reports UPDATE, routes the acting user, audits state_change/report/{action: reviewed}', async () => {
      grant(['reports:UPDATE'])

      const res = await request(app)
        .post('/api/reports/7/reviewed')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reportId: 7, reviewedBy: USER_ID })
      expect(mockedQueue.markReviewed).toHaveBeenCalledWith(7, USER_ID)
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledTimes(1)
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'report',
        7,
        { action: 'reviewed' }
      )
    })

    it('needs no body — a stray body is ignored, never validated (161: not a moderation act)', async () => {
      grant(['reports:UPDATE'])
      const res = await request(app)
        .post('/api/reports/7/reviewed')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam', note: 'ignored' })
      expect(res.status).toBe(200)
      expect(mockedQueue.markReviewed).toHaveBeenCalledWith(7, USER_ID)
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'report',
        7,
        { action: 'reviewed' }
      )
    })

    it('403 with only the VIEW grant — reviewing is UPDATE (165); no audit row', async () => {
      grant(['reports:VIEW'])
      const res = await request(app)
        .post('/api/reports/7/reviewed')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(403)
      expect(mockedQueue.markReviewed).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('404 and 409 DUPLICATE envelopes pass through and are not audited', async () => {
      grant(['reports:UPDATE'])

      mockedQueue.markReviewed.mockRejectedValueOnce(
        new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const missing = await request(app)
        .post('/api/reports/7/reviewed')
        .set('Authorization', `Bearer ${token}`)
      expect(missing.status).toBe(404)
      expect(missing.body.code).toBe(ErrorCodes.NOT_FOUND)

      mockedQueue.markReviewed.mockRejectedValueOnce(
        new HttpError(409, 'Report is already reviewed', undefined, ErrorCodes.DUPLICATE)
      )
      const already = await request(app)
        .post('/api/reports/7/reviewed')
        .set('Authorization', `Bearer ${token}`)
      expect(already.status).toBe(409)
      expect(already.body.code).toBe(ErrorCodes.DUPLICATE)

      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('400 on a non-numeric id', async () => {
      grant(['reports:UPDATE'])
      const res = await request(app)
        .post('/api/reports/abc/reviewed')
        .set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
    })

    it('401 without a token', async () => {
      const res = await request(app).post('/api/reports/7/reviewed')
      expect(res.status).toBe(401)
    })
  })

  it('search accepts reviewed=true|false and rejects other values (decision 83)', async () => {
    grant(['reports:VIEW'])
    mockedAdmin.searchReports.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })

    const ok = await request(app)
      .get('/api/reports?reviewed=false')
      .set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)
    expect(mockedAdmin.searchReports).toHaveBeenCalledWith({ page: 1, pageSize: 20, reviewed: false })

    const bad = await request(app)
      .get('/api/reports?reviewed=maybe')
      .set('Authorization', `Bearer ${token}`)
    expect(bad.status).toBe(422)
    expect(bad.body.fields).toEqual([
      expect.objectContaining({ field: 'reviewed', code: 'INVALID_OPTION' }),
    ])
  })
})
