import * as repository from '@modules/panic/panic-alert.repository'
import * as responderPoolService from '@modules/panic/responder-pool.service'
import * as service from '@modules/panic/panic-alert.service'
import { PanicAlertRow, ResponderAlertRow } from '@modules/panic/panic-alert.interface'
import { ResponderPoolMembershipRow } from '@modules/panic/responder-pool.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

jest.mock('@modules/panic/panic-alert.repository')
jest.mock('@modules/panic/responder-pool.service')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedResponderPool = responderPoolService as jest.Mocked<typeof responderPoolService>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const CLIENT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const OTHER_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const IP = '10.0.0.1'

const IDENTIFIED = { accountId: 42, clientKey: null, ip: IP }
const ANONYMOUS = { accountId: null, clientKey: null, ip: IP }

const INPUT = { clientKey: CLIENT_KEY, lat: -23.55, lng: -46.63 }

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

function member(overrides: Partial<ResponderPoolMembershipRow> = {}): ResponderPoolMembershipRow {
  return {
    id: 1,
    userId: 8,
    status: 'approved',
    criteriaNotes: null,
    requestedAt: new Date('2026-01-01'),
    resolvedAt: new Date('2026-01-02'),
    resolvedBy: 7,
    ...overrides,
  }
}

describe('panic-alert.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findAlertByClientKey.mockResolvedValue(null)
    mockedRepository.findActiveAlertByAccount.mockResolvedValue(null)
    mockedRepository.insertAlert.mockResolvedValue(alert())
    mockedRepository.insertRecipients.mockResolvedValue(undefined)
    mockedRepository.countRecipients.mockResolvedValue(0)
    mockedRepository.resolveAlert.mockResolvedValue(true)
    mockedResponderPool.findActiveResponders.mockResolvedValue([])
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
  })

  describe('triggerAlert', () => {
    it('creates an alert for an IDENTIFIED caller and snapshots the current active pool as recipients', async () => {
      mockedResponderPool.findActiveResponders.mockResolvedValue([
        member({ userId: 8 }),
        member({ userId: 9 }),
      ])
      mockedRepository.insertAlert.mockResolvedValue(alert({ accountId: 42 }))

      const result = await service.triggerAlert(INPUT, IDENTIFIED)

      expect(result).toEqual({
        alertId: 501,
        createdAt: '2026-09-04T12:00:00.000Z',
        recipientCount: 2,
        replayed: false,
      })
      expect(mockedRepository.insertAlert).toHaveBeenCalledWith({
        clientKey: CLIENT_KEY,
        accountId: 42,
        lat: INPUT.lat,
        lng: INPUT.lng,
      })
      expect(mockedRepository.insertRecipients).toHaveBeenCalledWith(501, [8, 9])
      // An identified triggerer leaves no accountability entry — the
      // session itself is the trail (pattern of rateHelper/help_offer).
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('creates an alert for an ANONYMOUS caller (clientKey only) and leaves the accountability trail', async () => {
      mockedResponderPool.findActiveResponders.mockResolvedValue([member({ userId: 8 })])
      mockedRepository.insertAlert.mockResolvedValue(alert({ accountId: null }))

      const result = await service.triggerAlert(INPUT, ANONYMOUS)

      expect(result.replayed).toBe(false)
      expect(result.recipientCount).toBe(1)
      expect(mockedRepository.insertAlert).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: null })
      )
      // Decision 23: the id only, NEVER the position.
      expect(mockedAccountability).toHaveBeenCalledWith('panic_alert.trigger', IP, { alertId: 501 })
    })

    it('creates the alert with ZERO recipients when the responder pool is empty — never a refusal (decision 65)', async () => {
      mockedResponderPool.findActiveResponders.mockResolvedValue([])

      const result = await service.triggerAlert(INPUT, IDENTIFIED)

      expect(result.recipientCount).toBe(0)
      expect(mockedRepository.insertAlert).toHaveBeenCalled()
      expect(mockedRepository.insertRecipients).toHaveBeenCalledWith(501, [])
    })

    it('replays the SAME alert on a repeated clientKey — re-derives recipientCount, never re-inserts', async () => {
      mockedRepository.findAlertByClientKey.mockResolvedValue(alert({ id: 900, accountId: 42 }))
      mockedRepository.countRecipients.mockResolvedValue(3)

      const result = await service.triggerAlert(INPUT, IDENTIFIED)

      expect(result).toEqual({
        alertId: 900,
        createdAt: '2026-09-04T12:00:00.000Z',
        recipientCount: 3,
        replayed: true,
      })
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
      expect(mockedGate).not.toHaveBeenCalled()
      expect(mockedResponderPool.findActiveResponders).not.toHaveBeenCalled()
    })

    describe('cooldown (decision 198)', () => {
      it('refuses a second trigger with 409 PANIC_ALERT_ACTIVE when the IDENTIFIED caller already has an unresolved alert', async () => {
        mockedRepository.findActiveAlertByAccount.mockResolvedValue(alert({ accountId: 42 }))

        await expect(service.triggerAlert({ ...INPUT, clientKey: OTHER_KEY }, IDENTIFIED)).rejects.toMatchObject(
          { statusCode: 409, code: ErrorCodes.PANIC_ALERT_ACTIVE }
        )
        expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
        expect(mockedGate).not.toHaveBeenCalled()
      })

      it('allows a new trigger once the previous alert is resolved (findActiveAlertByAccount finds none)', async () => {
        mockedRepository.findActiveAlertByAccount.mockResolvedValue(null)

        const result = await service.triggerAlert({ ...INPUT, clientKey: OTHER_KEY }, IDENTIFIED)

        expect(result.replayed).toBe(false)
        expect(mockedRepository.insertAlert).toHaveBeenCalled()
      })

      it('never cooldown-checks an ANONYMOUS caller — a fresh clientKey is a fresh identity by design, so findActiveAlertByAccount is never called', async () => {
        await service.triggerAlert(INPUT, ANONYMOUS)

        expect(mockedRepository.findActiveAlertByAccount).not.toHaveBeenCalled()
      })
    })

    it('checks the Legal Gate BEFORE any insert — 451 blocks the whole flow', async () => {
      mockedGate.mockRejectedValue(
        new HttpError(451, 'Blocked for legal reasons in this jurisdiction', undefined, ErrorCodes.LEGAL_BLOCKED, {
          capability: Capabilities.PANIC_DISPATCH,
          reason: 'unreviewed',
        })
      )

      await expect(service.triggerAlert(INPUT, IDENTIFIED)).rejects.toMatchObject({
        statusCode: 451,
        code: ErrorCodes.LEGAL_BLOCKED,
      })
      expect(mockedRepository.insertAlert).not.toHaveBeenCalled()
      expect(mockedResponderPool.findActiveResponders).not.toHaveBeenCalled()
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('asserts panic.dispatch with the caller ref and ip', async () => {
      await service.triggerAlert(INPUT, IDENTIFIED)
      expect(mockedGate).toHaveBeenCalledWith(Capabilities.PANIC_DISPATCH, { userRef: '42', ip: IP })

      await service.triggerAlert({ ...INPUT, clientKey: OTHER_KEY }, ANONYMOUS)
      expect(mockedGate).toHaveBeenCalledWith(Capabilities.PANIC_DISPATCH, { userRef: undefined, ip: IP })
    })

    it('logs (but never throws) when the accountability write fails for an anonymous trigger', async () => {
      const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined)
      mockedAccountability.mockRejectedValue(new Error('db down'))

      const result = await service.triggerAlert(INPUT, ANONYMOUS)

      expect(result.replayed).toBe(false)
      expect(loggerSpy).toHaveBeenCalled()
      loggerSpy.mockRestore()
    })
  })

  describe('listAlertsForResponder', () => {
    function row(overrides: Partial<ResponderAlertRow> = {}): ResponderAlertRow {
      return {
        alertId: 501,
        lat: -23.55,
        lng: -46.63,
        status: 'active',
        createdAt: new Date('2026-09-04T12:00:00Z'),
        ...overrides,
      }
    }

    it('computes distanceKm rounded to DISTANCE_STEP_BY_TIER.high (decision 195), never the raw lat/lng', async () => {
      mockedRepository.findAlertsForResponder.mockResolvedValue([row()])

      const result = await service.listAlertsForResponder(8, { after: 0, limit: 50, lat: -23.56, lng: -46.64 })

      expect(result.alerts).toHaveLength(1)
      expect(result.alerts[0]).toEqual({
        alertId: 501,
        distanceKm: expect.any(Number),
        createdAt: '2026-09-04T12:00:00.000Z',
        resolved: false,
      })
      expect(result.alerts[0]).not.toHaveProperty('lat')
      expect(result.alerts[0]).not.toHaveProperty('lng')
      // 1 km rounding step (195) — never a finer grid than the most
      // protective tier, since panic has no Category/RiskTierConfig.
      expect(result.alerts[0].distanceKm % 1).toBe(0)
    })

    it('flags a resolved alert instead of hiding it — no separate history endpoint', async () => {
      mockedRepository.findAlertsForResponder.mockResolvedValue([row({ status: 'resolved' })])

      const result = await service.listAlertsForResponder(8, { after: 0, limit: 50, lat: 0, lng: 0 })

      expect(result.alerts[0].resolved).toBe(true)
    })

    it('forwards the cursor and limit to the repository', async () => {
      mockedRepository.findAlertsForResponder.mockResolvedValue([])
      await service.listAlertsForResponder(8, { after: 501, limit: 20, lat: 0, lng: 0 })
      expect(mockedRepository.findAlertsForResponder).toHaveBeenCalledWith(8, 501, 20)
    })
  })

  describe('resolveAlert (decision 197 — only the triggerer resolves)', () => {
    it('resolves for the owner by ACCOUNT', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ accountId: 42 }))

      const result = await service.resolveAlert(501, { accountId: 42, clientKey: null })

      expect(result).toEqual({ alertId: 501, status: 'resolved' })
      expect(mockedRepository.resolveAlert).toHaveBeenCalledWith(501)
    })

    it('resolves for the owner by the bearer clientKey (anonymous triggerer)', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ accountId: null, clientKey: CLIENT_KEY }))

      const result = await service.resolveAlert(501, { accountId: null, clientKey: CLIENT_KEY })

      expect(result).toEqual({ alertId: 501, status: 'resolved' })
    })

    it('404s for a missing alert', async () => {
      mockedRepository.findAlertById.mockResolvedValue(null)

      await expect(service.resolveAlert(999, { accountId: 42, clientKey: null })).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })
      expect(mockedRepository.resolveAlert).not.toHaveBeenCalled()
    })

    it('404s (never 403) for a non-owner — a responder who answered cannot resolve someone else\'s alert', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ accountId: 42 }))

      await expect(service.resolveAlert(501, { accountId: 8, clientKey: null })).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })
      expect(mockedRepository.resolveAlert).not.toHaveBeenCalled()
    })

    it('409 PANIC_ALERT_ALREADY_RESOLVED when the atomic UPDATE affects zero rows', async () => {
      mockedRepository.findAlertById.mockResolvedValue(alert({ accountId: 42, status: 'resolved' }))
      mockedRepository.resolveAlert.mockResolvedValue(false)

      await expect(service.resolveAlert(501, { accountId: 42, clientKey: null })).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.PANIC_ALERT_ALREADY_RESOLVED,
      })
    })
  })
})
