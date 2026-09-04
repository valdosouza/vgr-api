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

// Plane fix (PP1 of plano-panico.md, correction applied alongside
// decisions 190-199): POST used to live here, admin-only, and read
// req.user!.userId — an ADMIN's tb_user.id stored where an APP account id
// (tb_user_account.id) belongs. It moved to /app-panic/responder-pool,
// guarded by appAuthMiddleware (responder-pool-app.routes.spec.ts) — this
// admin router keeps ONLY GET (list) and PUT :id/resolve, unchanged.
describe('POST /api/panic/responder-pool (removed — moved to /app-panic/responder-pool)', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedAcl.userHasPrivilege.mockImplementation(async (userId: number) => userId !== 42)
  })

  it('no longer answers under the admin-only /api plane, even with a valid admin token', async () => {
    const res = await request(app)
      .post('/api/panic/responder-pool')
      .set('Authorization', `Bearer ${tokenFor(7, 'admin')}`)

    expect(res.status).toBe(404)
    expect(mockedService.requestResponderAuthorization).not.toHaveBeenCalled()
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
