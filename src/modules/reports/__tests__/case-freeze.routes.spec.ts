import request from 'supertest'
import app from '../../../app'
import * as service from '@modules/reports/reports.service'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'

jest.mock('@modules/reports/reports.service')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

describe('/api/case-freeze (decisions 141/142 — the one panel surface)', () => {
  let token: string

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    mockedPrivileges.userHasPrivilege.mockResolvedValue(true)
    token = signSession(3, 1)
  })

  it('freezes with a mandatory reason and leaves the audit row (116/141)', async () => {
    mockedService.freezeCase.mockResolvedValue({ reportId: 7, frozen: true })

    const res = await request(app)
      .post('/api/case-freeze/7/freeze')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Ofício 123/2026' })

    expect(res.status).toBe(200)
    expect(mockedService.freezeCase).toHaveBeenCalledWith(7, 'Ofício 123/2026')
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'state_change',
      'case_freeze',
      7,
      { action: 'freeze', reason: 'Ofício 123/2026' }
    )
  })

  it('a freeze without reason is refused before the service runs', async () => {
    const res = await request(app)
      .post('/api/case-freeze/7/freeze')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(422)
    expect(mockedService.freezeCase).not.toHaveBeenCalled()
  })

  it('403 without the case_freeze grant — and no audit row', async () => {
    mockedPrivileges.userHasPrivilege.mockResolvedValue(false)
    const res = await request(app)
      .post('/api/case-freeze/7/freeze')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Ofício 123/2026' })
    expect(res.status).toBe(403)
    expect(mockedService.freezeCase).not.toHaveBeenCalled()
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('unfreeze approval routes the PANEL user id into the dual-control check (141d)', async () => {
    mockedService.approveUnfreeze.mockResolvedValue({ reportId: 7, frozen: false })

    const res = await request(app)
      .post('/api/case-freeze/7/unfreeze-approve')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(mockedService.approveUnfreeze).toHaveBeenCalledWith(7, 3)
  })

  it('app-plane tokens are a 401 here (decision 119 — plane separation)', async () => {
    const res = await request(app).post('/api/case-freeze/7/freeze').send({ reason: 'x' })
    expect(res.status).toBe(401)
  })
})
