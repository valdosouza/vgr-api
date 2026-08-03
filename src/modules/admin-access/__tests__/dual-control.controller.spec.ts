import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../../app'
import * as service from '../dual-control.service'

jest.mock('../dual-control.service')

const mockedService = service as jest.Mocked<typeof service>

function tokenFor(userId: number, role: string): string {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET ?? 'test-secret')
}

describe('POST /api/dual-control-access', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 201 with the created pending request for an admin caller', async () => {
    mockedService.createDualControlRequest.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: [],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })

    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ accountabilityLogEntryId: 99, legalBasis: 'Court order #123' })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('pending')
    expect(mockedService.createDualControlRequest).toHaveBeenCalledWith(99, 'Court order #123')
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'reporter')}`)
      .send({ accountabilityLogEntryId: 99, legalBasis: 'Court order #123' })

    expect(res.status).toBe(403)
    expect(mockedService.createDualControlRequest).not.toHaveBeenCalled()
  })

  it('returns 422 with the standardized error body when legalBasis is missing', async () => {
    const res = await request(app)
      .post('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ accountabilityLogEntryId: 99 })

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /api/dual-control-access', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 200 with every request for an admin caller', async () => {
    mockedService.listDualControlRequests.mockResolvedValue([
      { id: 1, accountabilityLogEntryId: 99, legalBasis: 'x', approverIds: [], status: 'pending', createdAt: new Date('2026-01-01') },
    ])

    const res = await request(app)
      .get('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/dual-control-access')
      .set('Authorization', `Bearer ${tokenFor(1, 'reporter')}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/dual-control-access/:id/approvals', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns 200 with the request still pending after the first distinct approval', async () => {
    mockedService.addApproval.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: ['admin-a'],
      status: 'pending',
      createdAt: new Date('2026-01-01'),
    })

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ approverId: 'admin-a' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('pending')
    expect(mockedService.addApproval).toHaveBeenCalledWith(1, 'admin-a')
  })

  it('returns 200 with status granted after the second distinct approval', async () => {
    mockedService.addApproval.mockResolvedValue({
      id: 1,
      accountabilityLogEntryId: 99,
      legalBasis: 'Court order #123',
      approverIds: ['admin-a', 'admin-b'],
      status: 'granted',
      createdAt: new Date('2026-01-01'),
    })

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ approverId: 'admin-b' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('granted')
  })

  it('returns 409 when the same approverId is reused on the same request', async () => {
    const { HttpError } = jest.requireActual('@shared/errors/http-error')
    mockedService.addApproval.mockRejectedValue(
      new HttpError(409, 'This approver has already approved this request', undefined, 'DUPLICATE')
    )

    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)
      .send({ approverId: 'admin-a' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DUPLICATE')
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .post('/api/dual-control-access/1/approvals')
      .set('Authorization', `Bearer ${tokenFor(1, 'reporter')}`)
      .send({ approverId: 'admin-a' })

    expect(res.status).toBe(403)
    expect(mockedService.addApproval).not.toHaveBeenCalled()
  })
})
