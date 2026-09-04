import request from 'supertest'
import app from '../../../app'
import * as accountRepository from '@modules/accounts/account.repository'
import { signAppAccessToken } from '@shared/auth/app-session'
import * as service from '../responder-pool.service'

jest.mock('../responder-pool.service')
jest.mock('@modules/accounts/account.repository')

const mockedService = service as jest.Mocked<typeof service>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>

/**
 * Plane fix (PP1 of plano-panico.md): POST /app-panic/responder-pool is
 * the mobile user's OWN request to become an Authorized Responder
 * (decisions 51, 190) — it belongs on the app plane, guarded by
 * appAuthMiddleware (REQUIRED, never optional: an anonymous witness
 * cannot become a vetted, accountable responder). GET (list) and
 * PUT :id/resolve stay admin-only under /api, untouched
 * (responder-pool.controller.spec.ts).
 */
function account(id: number) {
  return {
    id,
    displayName: 'Ana',
    email: 'ana@example.com',
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: null,
    jurisdiction: 'BR',
    consentVersion: 'v1',
    sessionVersion: 1,
    failedLoginCount: 0,
    totpSecret: null,
    totpEnabled: false,
    active: true,
  } as any
}

const tokenFor = (accountId: number) => `Bearer ${signAppAccessToken(accountId, 1)}`

describe('POST /app-panic/responder-pool (plane fix, decisions 51/190)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
  })

  it('creates a pending membership for the APP account, never req.user (401 anonymous)', async () => {
    mockedService.requestResponderAuthorization.mockResolvedValue({
      id: 1,
      userId: 42,
      status: 'pending',
      criteriaNotes: null,
      requestedAt: new Date('2026-01-01'),
      resolvedAt: null,
      resolvedBy: null,
    })

    const res = await request(app).post('/app-panic/responder-pool').set('Authorization', tokenFor(42))

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.status).toBe('pending')
    // The stored id is the APP account id (req.appAccountId), never an
    // admin's req.user.userId — the bug this phase fixes.
    expect(mockedService.requestResponderAuthorization).toHaveBeenCalledWith(42, undefined)
  })

  it('forwards free-text criteriaNotes when provided (decision 190 closes 52: no eligibility rule, free human judgment)', async () => {
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
      .post('/app-panic/responder-pool')
      .set('Authorization', tokenFor(42))
      .send({ criteriaNotes: 'Volunteer firefighter, 5 years' })

    expect(res.status).toBe(201)
    expect(res.body.data.criteriaNotes).toBe('Volunteer firefighter, 5 years')
    expect(mockedService.requestResponderAuthorization).toHaveBeenCalledWith(
      42,
      'Volunteer firefighter, 5 years'
    )
  })

  it('requires a real app token — no anonymous request (an identified-account-only action)', async () => {
    const res = await request(app).post('/app-panic/responder-pool')

    expect(res.status).toBe(401)
    expect(mockedService.requestResponderAuthorization).not.toHaveBeenCalled()
  })

  it('rejects a PANEL (admin) token — the two planes are never crossed (decision 119)', async () => {
    // A panel JWT has a different audience/shape than the app plane's
    // signAppAccessToken; appAuthMiddleware's verifyAppAccessToken rejects
    // it outright.
    const jwt = require('jsonwebtoken')
    const panelToken = jwt.sign({ userId: 7, role: 'admin', sv: 1 }, process.env.JWT_SECRET, {
      audience: 'admin',
    })

    const res = await request(app)
      .post('/app-panic/responder-pool')
      .set('Authorization', `Bearer ${panelToken}`)

    expect(res.status).toBe(401)
    expect(mockedService.requestResponderAuthorization).not.toHaveBeenCalled()
  })

  it('is never mounted under the admin plane (/api)', async () => {
    const res = await request(app)
      .post('/api/app-panic/responder-pool')
      .set('Authorization', tokenFor(42))

    expect(res.status).toBe(401)
    expect(mockedService.requestResponderAuthorization).not.toHaveBeenCalled()
  })
})
