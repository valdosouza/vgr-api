import jwt from 'jsonwebtoken'
import * as aclStore from '@shared/acl/privilege-store'
import * as adminAudit from '@shared/audit/admin-audit'
import request from 'supertest'
import app from '../../../app'
import * as service from '../dual-control.service'
import { DualControlAccessRequestRow } from '../dual-control.interface'

jest.mock('../dual-control.service')
jest.mock('@shared/audit/admin-audit')

const mockedService = service as jest.Mocked<typeof service>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

jest.mock('@shared/acl/privilege-store')

// Session check (decision 112): tokens below carry sv:1, store answers 1.
jest.mock('@shared/acl/session-store', () => ({
  getSessionInfo: async () => ({ sessionVersion: 1, active: true }),
  invalidateSession: () => undefined,
  invalidateAllSessions: () => undefined,
}))
const mockedAcl = aclStore as jest.Mocked<typeof aclStore>

function tokenFor(userId: number, role: string): string {
  return jwt.sign({ userId, role, sv: 1 }, process.env.JWT_SECRET ?? 'test-secret', { audience: 'admin' })
}

function requestRow(overrides: Partial<DualControlAccessRequestRow> = {}): DualControlAccessRequestRow {
  return {
    id: 1,
    accountabilityLogEntryId: 99,
    legalBasis: 'Court order #123',
    status: 'pending',
    requestedBy: 1,
    requestedByName: 'Ana',
    approvedBy: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('POST /api/dual-control-access', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('opens the request as the SESSION user and leaves an audit row (decisions 223/226)', async () => {
    mockedService.createDualControlRequest.mockResolvedValue(requestRow())

    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ accountabilityLogEntryId: 99, legalBasis: '  Court order #123  ' })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ status: 'pending', requestedBy: 1, requestedByName: 'Ana' })
    expect(mockedService.createDualControlRequest).toHaveBeenCalledWith(99, 'Court order #123', 1)
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'state_change',
      'dual_control_access',
      1,
      { action: 'request', accountabilityLogEntryId: 99, legalBasis: 'Court order #123' }
    )
  })

  it('answers 404 for an accountability entry that does not exist — and no audit row', async () => {
    const { HttpError } = jest.requireActual('@shared/errors/http-error')
    mockedService.createDualControlRequest.mockRejectedValue(
      new HttpError(404, 'Accountability log entry not found', undefined, 'NOT_FOUND')
    )

    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ accountabilityLogEntryId: 404, legalBasis: 'Court order #123' })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)
      .send({ accountabilityLogEntryId: 99, legalBasis: 'Court order #123' })

    expect(res.status).toBe(403)
    expect(mockedService.createDualControlRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['legalBasis is missing', { accountabilityLogEntryId: 99 }],
    ['legalBasis is blank', { accountabilityLogEntryId: 99, legalBasis: '   ' }],
    ['legalBasis exceeds the column', { accountabilityLogEntryId: 99, legalBasis: 'x'.repeat(501) }],
  ])('returns 422 with the standardized error body when %s', async (_case, body) => {
    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send(body)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(res.body.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'legalBasis' })]))
    expect(mockedService.createDualControlRequest).not.toHaveBeenCalled()
  })
})

describe('GET /api/dual-control-access', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('without page keeps the plain list', async () => {
    mockedService.listDualControlRequests.mockResolvedValue([requestRow()])

    const res = await request(app)
      .get('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(mockedService.listDualControlRequests).toHaveBeenCalledWith({ pageSize: 20 })
  })

  it('with page answers the envelope and passes the trimmed filter (decisions 220/227)', async () => {
    mockedService.listDualControlRequests.mockResolvedValue({ items: [requestRow()], page: 2, pageSize: 10, total: 11 })

    const res = await request(app)
      .get('/api/dual-control-access?page=2&pageSize=10&filter=%20Court%20')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ page: 2, pageSize: 10, total: 11 })
    expect(mockedService.listDualControlRequests).toHaveBeenCalledWith({ page: 2, pageSize: 10, filter: 'Court' })
  })

  it('returns 422 for a pageSize over the limit', async () => {
    const res = await request(app)
      .get('/api/dual-control-access?page=1&pageSize=1000')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(mockedService.listDualControlRequests).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/dual-control-access/:id/approvals', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('approves as the SESSION user, ignoring any approverId in the body (decision 223), and audits it', async () => {
    mockedService.approveDualControlRequest.mockResolvedValue(
      requestRow({ status: 'granted', approvedBy: 2, approvedByName: 'Bia', approvedAt: new Date('2026-01-02') })
    )

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(2, 'admin')}`)
      .send({ approverId: 'someone-else' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'granted', approvedBy: 2, approvedByName: 'Bia' })
    expect(mockedService.approveDualControlRequest).toHaveBeenCalledWith(1, 2)
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'state_change',
      'dual_control_access',
      1,
      { action: 'approve' }
    )
  })

  it('returns 422 when the requester approves their own request — and no audit row (224)', async () => {
    const { HttpError } = jest.requireActual('@shared/errors/http-error')
    mockedService.approveDualControlRequest.mockRejectedValue(
      new HttpError(422, 'The approver must be a different user than the requester', undefined, 'BUSINESS_RULE')
    )

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('BUSINESS_RULE')
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('returns 409 when the request is no longer pending', async () => {
    const { HttpError } = jest.requireActual('@shared/errors/http-error')
    mockedService.approveDualControlRequest.mockRejectedValue(
      new HttpError(409, 'Request is not awaiting approval', undefined, 'BUSINESS_RULE')
    )

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(2, 'admin')}`)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('BUSINESS_RULE')
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)

    expect(res.status).toBe(403)
    expect(mockedService.approveDualControlRequest).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller operates the screen but lacks the approver resource (decisions 45/93)', async () => {
    mockedAcl.userHasPrivilege.mockImplementation(
      async (_userId: number, interfaceKey: string) => interfaceKey !== 'dual_control_approval'
    )

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(403)
    expect(mockedService.approveDualControlRequest).not.toHaveBeenCalled()
  })
})
