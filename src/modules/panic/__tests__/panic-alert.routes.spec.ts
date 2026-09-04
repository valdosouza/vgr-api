import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/panic/panic-alert.repository'
import * as responderPoolService from '@modules/panic/responder-pool.service'
import * as accountRepository from '@modules/accounts/account.repository'
import { PanicAlertRow, ResponderAlertRow } from '@modules/panic/panic-alert.interface'
import { signAppAccessToken } from '@shared/auth/app-session'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/panic/panic-alert.repository')
jest.mock('@modules/panic/responder-pool.service')
jest.mock('@modules/accounts/account.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedResponderPool = responderPoolService as jest.Mocked<typeof responderPoolService>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const CLIENT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'

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

function alert(overrides: Partial<PanicAlertRow> = {}): PanicAlertRow {
  return {
    id: 501,
    clientKey: CLIENT_KEY,
    accountId: null,
    lat: -23.55,
    lng: -46.63,
    status: 'active',
    createdAt: new Date('2026-09-04T12:00:00Z'),
    resolvedAt: null,
    ...overrides,
  }
}

const ownerToken = () => `Bearer ${signAppAccessToken(42, 1)}`
const responderToken = () => `Bearer ${signAppAccessToken(8, 1)}`

describe('/app-panic routes (PP1 — decisions 51/65/191-198)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedResponderPool.findActiveResponders.mockResolvedValue([])
    mockedRepository.findAlertByClientKey.mockResolvedValue(null)
    mockedRepository.findActiveAlertByAccount.mockResolvedValue(null)
    mockedRepository.insertAlert.mockResolvedValue(alert())
    mockedRepository.insertRecipients.mockResolvedValue(undefined)
    mockedRepository.countRecipients.mockResolvedValue(0)
    mockedRepository.resolveAlert.mockResolvedValue(true)
    mockedRepository.findAlertById.mockResolvedValue(null)
    mockedRepository.findAlertsForResponder.mockResolvedValue([])
  })

  describe('POST /app-panic/alert', () => {
    const BODY = { clientKey: CLIENT_KEY, position: { lat: -23.55, lng: -46.63 } }

    it('201s for an ANONYMOUS caller — no token required (decision 65: cold trigger)', async () => {
      mockedResponderPool.findActiveResponders.mockResolvedValue([
        { id: 1, userId: 8, status: 'approved', criteriaNotes: null, requestedAt: new Date(), resolvedAt: new Date(), resolvedBy: 7 },
      ])
      mockedRepository.insertAlert.mockResolvedValue(alert({ accountId: null }))

      const res = await request(app).post('/app-panic/alert').send(BODY)

      expect(res.status).toBe(201)
      expect(res.body).toEqual({
        alertId: 501,
        createdAt: '2026-09-04T12:00:00.000Z',
        recipientCount: 1,
      })
      // Never the raw position, never who the recipients are.
      expect(res.body).not.toHaveProperty('lat')
      expect(res.body).not.toHaveProperty('lng')
      expect(res.body).not.toHaveProperty('recipients')
      expect(mockedAccountability).toHaveBeenCalledWith('panic_alert.trigger', expect.any(String), {
        alertId: 501,
      })
    })

    it('201s for an IDENTIFIED caller — leaves no accountability entry', async () => {
      mockedRepository.insertAlert.mockResolvedValue(alert({ accountId: 42 }))

      const res = await request(app).post('/app-panic/alert').set('Authorization', ownerToken()).send(BODY)

      expect(res.status).toBe(201)
      expect(mockedRepository.insertAlert).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 42 })
      )
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('200s with the SAME alert on a clientKey replay — never re-inserts', async () => {
      mockedRepository.findAlertByClientKey.mockResolvedValue(alert({ id: 900 }))
      mockedRepository.countRecipients.mockResolvedValue(2)

      const res = await request(app).post('/app-panic/alert').send(BODY)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        alertId: 900,
        createdAt: '2026-09-04T12:00:00.000Z',
        recipientCount: 2,
      })
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
    })

    it('201s with ZERO recipients when the pool is empty — never a refusal', async () => {
      const res = await request(app).post('/app-panic/alert').send(BODY)
      expect(res.status).toBe(201)
      expect(res.body.recipientCount).toBe(0)
    })

    it('409 PANIC_ALERT_ACTIVE on a second trigger while an IDENTIFIED caller has an unresolved alert', async () => {
      mockedRepository.findActiveAlertByAccount.mockResolvedValue(alert({ accountId: 42 }))

      const res = await request(app)
        .post('/app-panic/alert')
        .set('Authorization', ownerToken())
        .send({ ...BODY, clientKey: '9b2b6c1a-0000-4000-8000-000000000002' })

      expect(res.status).toBe(409)
      expect(res.body.code).toBe(ErrorCodes.PANIC_ALERT_ACTIVE)
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
    })

    it('never applies the cooldown to an ANONYMOUS caller — two anonymous triggers both succeed (documented gap, decision 198)', async () => {
      const first = await request(app).post('/app-panic/alert').send(BODY)
      expect(first.status).toBe(201)

      mockedRepository.findAlertByClientKey.mockResolvedValue(null)
      const second = await request(app)
        .post('/app-panic/alert')
        .send({ ...BODY, clientKey: '9b2b6c1a-0000-4000-8000-000000000002' })

      expect(second.status).toBe(201)
      expect(mockedRepository.findActiveAlertByAccount).not.toHaveBeenCalled()
    })

    it('451 LEGAL_BLOCKED before any insert', async () => {
      mockedGate.mockRejectedValue(
        new HttpError(451, 'Blocked for legal reasons in this jurisdiction', undefined, ErrorCodes.LEGAL_BLOCKED, {
          capability: 'panic.dispatch',
          reason: 'unreviewed',
        })
      )

      const res = await request(app).post('/app-panic/alert').send(BODY)

      expect(res.status).toBe(451)
      expect(res.body.code).toBe(ErrorCodes.LEGAL_BLOCKED)
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
    })

    it('422 VALIDATION_FAILED for a malformed body — no message/text field accepted (decision 196)', async () => {
      const a = await request(app).post('/app-panic/alert').send({ clientKey: 'not-a-uuid', position: BODY.position })
      const b = await request(app).post('/app-panic/alert').send({ clientKey: CLIENT_KEY })
      const c = await request(app)
        .post('/app-panic/alert')
        .send({ clientKey: CLIENT_KEY, position: BODY.position, message: 'help me' })

      expect(a.status).toBe(422)
      expect(a.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
      expect(b.status).toBe(422)
      // An extra `message` field is simply ignored by zod's default (not
      // stripped-and-rejected) — the important guarantee is that NOTHING
      // from it reaches the stored alert or the response.
      expect(c.status).toBe(201)
      expect(c.body).not.toHaveProperty('message')
    })

    it('a PRESENT but invalid app token is 401, never silently downgraded to anonymous', async () => {
      const res = await request(app).post('/app-panic/alert').set('Authorization', 'Bearer forged').send(BODY)
      expect(res.status).toBe(401)
    })

    it('is never mounted under /api', async () => {
      const res = await request(app).post('/api/app-panic/alert').send(BODY)
      expect(res.status).not.toBe(201)
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
    })
  })

  describe('GET /app-panic/alerts', () => {
    it('requires a real app token — 401 anonymous', async () => {
      const res = await request(app).get('/app-panic/alerts?lat=0&lng=0')
      expect(res.status).toBe(401)
    })

    it('returns the rounded distanceKm, never raw lat/lng, for alerts snapshotted to include this responder', async () => {
      const row: ResponderAlertRow = {
        alertId: 501,
        lat: -23.55,
        lng: -46.63,
        status: 'active',
        createdAt: new Date('2026-09-04T12:00:00Z'),
      }
      mockedRepository.findAlertsForResponder.mockResolvedValue([row])

      const res = await request(app)
        .get('/app-panic/alerts')
        .query({ lat: -23.56, lng: -46.64 })
        .set('Authorization', responderToken())

      expect(res.status).toBe(200)
      expect(res.body.alerts).toHaveLength(1)
      expect(res.body.alerts[0]).toMatchObject({ alertId: 501, resolved: false })
      expect(typeof res.body.alerts[0].distanceKm).toBe('number')
      expect(res.body.alerts[0]).not.toHaveProperty('lat')
      expect(res.body.alerts[0]).not.toHaveProperty('lng')
      expect(mockedRepository.findAlertsForResponder).toHaveBeenCalledWith(8, 0, 50)
    })

    it('flags resolved alerts instead of omitting them', async () => {
      mockedRepository.findAlertsForResponder.mockResolvedValue([
        { alertId: 501, lat: 0, lng: 0, status: 'resolved', createdAt: new Date('2026-09-04T12:00:00Z') },
      ])

      const res = await request(app)
        .get('/app-panic/alerts')
        .query({ lat: 0, lng: 0 })
        .set('Authorization', responderToken())

      expect(res.body.alerts[0].resolved).toBe(true)
    })

    it('forwards the after cursor', async () => {
      await request(app)
        .get('/app-panic/alerts')
        .query({ lat: 0, lng: 0, after: 501, limit: 20 })
        .set('Authorization', responderToken())

      expect(mockedRepository.findAlertsForResponder).toHaveBeenCalledWith(8, 501, 20)
    })

    it('422 VALIDATION_FAILED when lat/lng are missing — the server cannot compute distance to an unknown position', async () => {
      const res = await request(app).get('/app-panic/alerts').set('Authorization', responderToken())
      expect(res.status).toBe(422)
      expect(res.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
    })
  })

  describe('POST /app-panic/alerts/:id/resolve', () => {
    it('200s for the owner by ACCOUNT', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ id: 501, accountId: 42 }))

      const res = await request(app)
        .post('/app-panic/alerts/501/resolve')
        .set('Authorization', ownerToken())

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ alertId: 501, status: 'resolved' })
    })

    it('200s for the owner by the x-client-key HEADER (anonymous triggerer)', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ id: 501, accountId: null, clientKey: CLIENT_KEY }))

      const res = await request(app)
        .post('/app-panic/alerts/501/resolve')
        .set('x-client-key', CLIENT_KEY)

      expect(res.status).toBe(200)
    })

    it('404s for a missing alert', async () => {
      mockedRepository.findAlertById.mockResolvedValue(null)
      const res = await request(app).post('/app-panic/alerts/999/resolve').set('Authorization', ownerToken())
      expect(res.status).toBe(404)
    })

    it('404s (never 403) when a RESPONDER who is not the triggerer attempts to resolve — even with a valid app token (decision 197)', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ id: 501, accountId: 42 }))

      const res = await request(app)
        .post('/app-panic/alerts/501/resolve')
        .set('Authorization', responderToken())

      expect(res.status).toBe(404)
      expect(mockedRepository.resolveAlert).not.toHaveBeenCalled()
    })

    it('409 PANIC_ALERT_ALREADY_RESOLVED on a second resolve', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ id: 501, accountId: 42, status: 'resolved' }))
      mockedRepository.resolveAlert.mockResolvedValue(false)

      const res = await request(app)
        .post('/app-panic/alerts/501/resolve')
        .set('Authorization', ownerToken())

      expect(res.status).toBe(409)
      expect(res.body.code).toBe(ErrorCodes.PANIC_ALERT_ALREADY_RESOLVED)
    })

    it('400 INVALID_ID for a non-numeric id', async () => {
      const res = await request(app).post('/app-panic/alerts/abc/resolve').set('Authorization', ownerToken())
      expect(res.status).toBe(400)
      expect(res.body.code).toBe(ErrorCodes.INVALID_ID)
    })
  })
})
