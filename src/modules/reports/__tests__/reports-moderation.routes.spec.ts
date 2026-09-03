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

const USER_ID = 3

/** Grants by "interface:privilege" — moderation needs reports:UPDATE (165). */
function grant(pairs: string[]): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey, privilege) => pairs.includes(`${interfaceKey}:${privilege}`)
  )
}

describe('/api/reports/:id/hide and /unhide (B2 — decisions 162/163/165)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    grant(['reports:UPDATE'])
    token = signSession(USER_ID, 1)
    mockedService.hideReport.mockResolvedValue({ reportId: 7, hidden: true } as any)
    mockedService.unhideReport.mockResolvedValue({ reportId: 7, hidden: false } as any)
  })

  describe('POST /api/reports/:id/hide', () => {
    it('hides with the reports UPDATE grant, routes the acting user, audits state_change/report with the reason', async () => {
      const res = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reportId: 7, hidden: true })
      expect(mockedService.hideReport).toHaveBeenCalledWith(7, { reasonCode: 'spam' }, USER_ID)
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'report',
        7,
        { action: 'hide', reasonCode: 'spam', note: null }
      )
    })

    it('carries the note into the service and the audit summary', async () => {
      await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other', note: 'names a minor' })

      expect(mockedService.hideReport).toHaveBeenCalledWith(
        7,
        { reasonCode: 'other', note: 'names a minor' },
        USER_ID
      )
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'report',
        7,
        { action: 'hide', reasonCode: 'other', note: 'names a minor' }
      )
    })

    it('422 with field codes: `other` without a note, unknown code (decisions 83/163) — service never runs', async () => {
      const noNote = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other' })
      expect(noNote.status).toBe(422)
      expect(noNote.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      expect(noNote.body.fields).toEqual([
        expect.objectContaining({ field: 'note', code: 'REQUIRED' }),
      ])

      const badCode = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'rude' })
      expect(badCode.status).toBe(422)
      expect(badCode.body.fields).toEqual([
        expect.objectContaining({ field: 'reasonCode', code: 'INVALID_OPTION' }),
      ])

      const empty = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({})
      expect(empty.status).toBe(422)

      expect(mockedService.hideReport).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('403 with only the VIEW grant — moderation is UPDATE (165); no audit row', async () => {
      grant(['reports:VIEW'])
      const res = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(403)
      expect(mockedService.hideReport).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('404 and 409 envelopes pass through and are not audited', async () => {
      mockedService.hideReport.mockRejectedValueOnce(
        new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
      )
      const missing = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(missing.status).toBe(404)
      expect(missing.body.code).toBe(ErrorCodes.NOT_FOUND)

      mockedService.hideReport.mockRejectedValueOnce(
        new HttpError(409, 'Report is already hidden', undefined, ErrorCodes.DUPLICATE)
      )
      const already = await request(app)
        .post('/api/reports/7/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(already.status).toBe(409)
      expect(already.body.code).toBe(ErrorCodes.DUPLICATE)

      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })

    it('400 on a non-numeric id', async () => {
      const res = await request(app)
        .post('/api/reports/abc/hide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
    })
  })

  describe('POST /api/reports/:id/unhide', () => {
    it('reverts under the SAME rule: one human with UPDATE + a reason, audited (162)', async () => {
      const res = await request(app)
        .post('/api/reports/7/unhide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'other', note: 'appeal upheld' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ reportId: 7, hidden: false })
      expect(mockedService.unhideReport).toHaveBeenCalledWith(
        7,
        { reasonCode: 'other', note: 'appeal upheld' },
        USER_ID
      )
      expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        'state_change',
        'report',
        7,
        { action: 'unhide', reasonCode: 'other', note: 'appeal upheld' }
      )
    })

    it('the reason for reverting is mandatory too', async () => {
      const res = await request(app)
        .post('/api/reports/7/unhide')
        .set('Authorization', `Bearer ${token}`)
        .send({})
      expect(res.status).toBe(422)
      expect(mockedService.unhideReport).not.toHaveBeenCalled()
    })

    it('403 without reports UPDATE', async () => {
      grant(['reports:VIEW', 'case_freeze:UPDATE'])
      const res = await request(app)
        .post('/api/reports/7/unhide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(403)
      expect(mockedService.unhideReport).not.toHaveBeenCalled()
    })

    it('409 when not hidden passes through, not audited', async () => {
      mockedService.unhideReport.mockRejectedValueOnce(
        new HttpError(409, 'Report is not hidden', undefined, ErrorCodes.DUPLICATE)
      )
      const res = await request(app)
        .post('/api/reports/7/unhide')
        .set('Authorization', `Bearer ${token}`)
        .send({ reasonCode: 'spam' })
      expect(res.status).toBe(409)
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    })
  })

  it('search accepts hidden=true|false and rejects other values (decision 83)', async () => {
    grant(['reports:VIEW'])
    mockedService.searchReports.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })

    const ok = await request(app)
      .get('/api/reports?hidden=true')
      .set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)
    expect(mockedService.searchReports).toHaveBeenCalledWith({ page: 1, pageSize: 20, hidden: true })

    const bad = await request(app)
      .get('/api/reports?hidden=yes')
      .set('Authorization', `Bearer ${token}`)
    expect(bad.status).toBe(422)
    expect(bad.body.fields).toEqual([
      expect.objectContaining({ field: 'hidden', code: 'INVALID_OPTION' }),
    ])
  })

  it('no token is a 401', async () => {
    const res = await request(app).post('/api/reports/7/hide').send({ reasonCode: 'spam' })
    expect(res.status).toBe(401)
  })
})
