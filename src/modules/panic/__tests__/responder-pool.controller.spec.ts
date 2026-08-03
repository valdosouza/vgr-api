import jwt from 'jsonwebtoken'
import * as aclStore from '@shared/acl/privilege-store'
import request from 'supertest'
import app from '../../../app'
import * as service from '../responder-pool.service'

jest.mock('../responder-pool.service')

const mockedService = service as jest.Mocked<typeof service>

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

describe('POST /api/panic/responder-pool', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('returns 201 with the created pending membership for any authenticated Role', async () => {
    mockedService.requestResponderAuthorization.mockResolvedValue({
      id: 1,
      userId: 42,
      status: 'pending',
      criteriaNotes: null,
      requestedAt: new Date('2026-01-01'),
      resolvedAt: null,
      resolvedBy: null,
    })

    const res = await request(app)
      .post('/api/panic/responder-pool')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.status).toBe('pending')
    expect(mockedService.requestResponderAuthorization).toHaveBeenCalledWith(42, undefined)
  })

  it('forwards free-text criteriaNotes when provided (decision 52 still open, no validation rules yet)', async () => {
    mockedService.requestResponderAuthorization.mockResolvedValue({
      id: 1,
      userId: 42,
      status: 'pending',
      criteriaNotes: 'Volunteer firefighter, 5 years',
      requestedAt: new Date('2026-01-01'),
      resolvedAt: null,
      resolvedBy: null,
    })

    const res = await request(app)
      .post('/api/panic/responder-pool')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)
      .send({ criteriaNotes: 'Volunteer firefighter, 5 years' })

    expect(res.status).toBe(201)
    expect(res.body.data.criteriaNotes).toBe('Volunteer firefighter, 5 years')
    expect(mockedService.requestResponderAuthorization).toHaveBeenCalledWith(42, 'Volunteer firefighter, 5 years')
  })
})

describe('GET /api/panic/responder-pool', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('returns 200 with the pending queue for an admin caller', async () => {
    mockedService.listPendingResponderRequests.mockResolvedValue([
      { id: 1, userId: 42, status: 'pending', criteriaNotes: null, requestedAt: new Date('2026-01-01'), resolvedAt: null, resolvedBy: null },
    ])

    const res = await request(app)
      .get('/api/panic/responder-pool')
      .set('Authorization', `Bearer ${tokenFor(1, 'admin')}`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data).toHaveLength(1)
  })

  it('returns 403 for a non-admin caller', async () => {
    const res = await request(app)
      .get('/api/panic/responder-pool')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)

    expect(res.status).toBe(403)
    expect(mockedService.listPendingResponderRequests).not.toHaveBeenCalled()
  })
})

describe('PUT /api/panic/responder-pool/:id/resolve', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('returns 200 and forwards the resolving admin when an admin approves', async () => {
    mockedService.resolveResponderRequest.mockResolvedValue(undefined)

    const res = await request(app)
      .put('/api/panic/responder-pool/1/resolve')
      .set('Authorization', `Bearer ${tokenFor(7, 'admin')}`)
      .send({ approved: true })

    expect(res.status).toBe(200)
    expect(mockedService.resolveResponderRequest).toHaveBeenCalledWith(1, true, 7)
  })

  it('returns 403 when a non-admin caller attempts to resolve', async () => {
    const res = await request(app)
      .put('/api/panic/responder-pool/1/resolve')
      .set('Authorization', `Bearer ${tokenFor(42, 'reporter')}`)
      .send({ approved: true })

    expect(res.status).toBe(403)
    expect(mockedService.resolveResponderRequest).not.toHaveBeenCalled()
  })

  it('returns 422 with the standardized error body for a missing approved field', async () => {
    const res = await request(app)
      .put('/api/panic/responder-pool/1/resolve')
      .set('Authorization', `Bearer ${tokenFor(7, 'admin')}`)
      .send({})

    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
  })
})
