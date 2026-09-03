import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/messaging/chat-admin.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/messaging/chat-admin.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

/** Grant table per interface key — the stacked chat guard needs both. */
function grant(keys: Record<string, boolean>): void {
  mockedPrivileges.userHasPrivilege.mockImplementation(
    async (_userId, interfaceKey) => keys[interfaceKey] === true
  )
}

const EVIDENCE = { reportId: 7, tier: 'low' as const, threads: [] }

describe('GET /api/reports/:id/chat — audited panel read (C3, decision 175)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    grant({ reports: true, chat_evidence: true })
    mockedService.getReportChatEvidence.mockResolvedValue(EVIDENCE)
    token = signSession(3, 1)
  })

  it('needs the SECOND grant (chat_evidence) on top of reports — 403, service never runs, no audit row', async () => {
    grant({ reports: true })
    const res = await request(app).get('/api/reports/7/chat').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('the chat_evidence grant alone is not enough either (stacked)', async () => {
    grant({ chat_evidence: true })
    const res = await request(app).get('/api/reports/7/chat').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
  })

  it('with both grants: serves the evidence, audits read/report_chat/id once, no-store (116/166/175)', async () => {
    const res = await request(app).get('/api/reports/7/chat').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(EVIDENCE)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(mockedService.getReportChatEvidence).toHaveBeenCalledWith(7, { limit: 200 })
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledTimes(1)
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'read',
      'report_chat',
      7
    )
  })

  it('passes ?limit through (1..500)', async () => {
    const res = await request(app)
      .get('/api/reports/7/chat?limit=500')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(mockedService.getReportChatEvidence).toHaveBeenCalledWith(7, { limit: 500 })
  })

  it.each([
    ['0', 'TOO_SHORT'],
    ['501', 'TOO_LONG'],
    ['abc', 'INVALID_VALUE'],
  ])('422 with a field code on limit=%s (decision 83) — nothing audited', async (limit, code) => {
    const res = await request(app)
      .get(`/api/reports/7/chat?limit=${limit}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
    expect(res.body.fields).toEqual([expect.objectContaining({ field: 'limit', code })])
    expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('404 envelope passes through and nothing is audited', async () => {
    mockedService.getReportChatEvidence.mockRejectedValue(
      new HttpError(404, 'Report not found', undefined, ErrorCodes.NOT_FOUND)
    )
    const res = await request(app).get('/api/reports/7/chat').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('400 on a non-numeric id', async () => {
    const res = await request(app).get('/api/reports/abc/chat').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
    expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
  })

  it.each(['post', 'put', 'delete', 'patch'] as const)(
    'READ ONLY (175): %s on the path is a 404 and touches nothing',
    async (method) => {
      const res = await request(app)
        [method]('/api/reports/7/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: 'x' })
      expect(res.status).toBe(404)
      expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
      expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
    }
  )

  it('no token is a 401 (panel plane, decision 119)', async () => {
    const res = await request(app).get('/api/reports/7/chat')
    expect(res.status).toBe(401)
    expect(mockedService.getReportChatEvidence).not.toHaveBeenCalled()
  })
})
