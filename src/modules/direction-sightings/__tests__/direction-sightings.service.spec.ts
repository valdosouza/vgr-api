import * as repository from '@modules/direction-sightings/direction-sightings.repository'
import * as service from '@modules/direction-sightings/direction-sightings.service'
import { DirectionSightingRow, ReportForSightingRow } from '@modules/direction-sightings/direction-sightings.interface'
import { DirectionAccumulatorRow } from '@shared/direction-sighting/direction-estimate'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import logger from '@shared/logger/logger'

jest.mock('@modules/direction-sightings/direction-sightings.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

const CLIENT_KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const OTHER_KEY = '9b2b6c1a-0000-4000-8000-000000000002'
const IP = '10.0.0.1'

const IDENTIFIED = { accountId: 42, ip: IP }
const ANONYMOUS = { accountId: null, ip: IP }

const INPUT = { reportId: 7, direction: 'N' as const, clientKey: CLIENT_KEY }

function report(overrides: Partial<ReportForSightingRow> = {}): ReportForSightingRow {
  return {
    id: 7,
    reporterAccountId: 99,
    status: 'open',
    category: 'robbery',
    ...overrides,
  }
}

function sighting(overrides: Partial<DirectionSightingRow> = {}): DirectionSightingRow {
  return {
    id: 501,
    reportId: 7,
    direction: 'N',
    weight: 1,
    accountId: 42,
    clientKey: CLIENT_KEY,
    createdAt: new Date('2026-09-04T12:00:00Z'),
    ...overrides,
  }
}

function accRow(overrides: Partial<DirectionAccumulatorRow> = {}): DirectionAccumulatorRow {
  return {
    direction: 'N',
    totalWeight: 1,
    sightingCount: 1,
    firstReportedAt: new Date('2026-09-04T12:00:00Z'),
    ...overrides,
  }
}

describe('direction-sightings.service — LogDirectionSighting (DS1, decisions 200-207)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    delete process.env.DIRECTION_SIGHTING_MIN_COUNT
    delete process.env.SIGHTING_WEIGHT_IDENTIFIED
    delete process.env.SIGHTING_WEIGHT_ANONYMOUS
    mockedRepository.findSightingByClientKey.mockResolvedValue(null)
    mockedRepository.findReportForSighting.mockResolvedValue(report())
    mockedRepository.insertSighting.mockResolvedValue(sighting())
    mockedRepository.findEstimateRows.mockResolvedValue([accRow()])
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
  })

  describe('category eligibility (decision 201)', () => {
    it('accepts a sighting on an ELIGIBLE category (robbery)', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ category: 'robbery' }))
      const result = await service.logDirectionSighting(INPUT, IDENTIFIED)
      expect(result.sightingId).toBe(501)
      expect(mockedRepository.insertSighting).toHaveBeenCalled()
    })

    it('refuses an INELIGIBLE category (assault) with 422 DIRECTION_SIGHTING_NOT_ELIGIBLE, no insert', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ category: 'assault' }))
      await expect(service.logDirectionSighting(INPUT, IDENTIFIED)).rejects.toMatchObject({
        statusCode: 422,
        code: ErrorCodes.DIRECTION_SIGHTING_NOT_ELIGIBLE,
      })
      expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
      expect(mockedGate).not.toHaveBeenCalled()
    })

    it('refuses a free-tag report (null category) — no category is ever eligible', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ category: null }))
      await expect(service.logDirectionSighting(INPUT, IDENTIFIED)).rejects.toMatchObject({
        statusCode: 422,
        code: ErrorCodes.DIRECTION_SIGHTING_NOT_ELIGIBLE,
      })
    })
  })

  it('404s when the report does not exist', async () => {
    mockedRepository.findReportForSighting.mockResolvedValue(null)
    await expect(service.logDirectionSighting(INPUT, IDENTIFIED)).rejects.toMatchObject({
      statusCode: 404,
      code: ErrorCodes.NOT_FOUND,
    })
    expect(mockedGate).not.toHaveBeenCalled()
  })

  describe('report must be open', () => {
    it('refuses a RESOLVED report with 422 BUSINESS_RULE, mirroring help-offers wording', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ status: 'resolved' }))
      await expect(service.logDirectionSighting(INPUT, IDENTIFIED)).rejects.toMatchObject({
        statusCode: 422,
        code: ErrorCodes.BUSINESS_RULE,
      })
      expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
    })
  })

  describe('self-dealing (decision 200 — mirrors help-offers.service.ts exactly)', () => {
    it('refuses the IDENTIFIED reporter sighting their OWN report — 422 BUSINESS_RULE', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ reporterAccountId: 42 }))
      await expect(
        service.logDirectionSighting(INPUT, { accountId: 42, ip: IP })
      ).rejects.toMatchObject({ statusCode: 422, code: ErrorCodes.BUSINESS_RULE })
      expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
    })

    it('allows a DIFFERENT identified account to sight the same report', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ reporterAccountId: 99 }))
      const result = await service.logDirectionSighting(INPUT, { accountId: 42, ip: IP })
      expect(result.sightingId).toBe(501)
    })

    it('allows ANY anonymous caller, even one presenting the report\'s OWN client key — the self-dealing check ONLY compares identified account ids (help-offers precedent: fully anonymous actors are covered by the accountability log, 23, not by this check)', async () => {
      mockedRepository.findReportForSighting.mockResolvedValue(report({ reporterAccountId: 99 }))
      // The sighting's own clientKey field has no relationship to the
      // report's ownership secret — nothing in the service ever compares
      // them, by design (see the interface file's comment).
      const result = await service.logDirectionSighting(
        { ...INPUT, clientKey: OTHER_KEY },
        { accountId: null, ip: IP }
      )
      expect(result.sightingId).toBe(501)
      expect(mockedRepository.insertSighting).toHaveBeenCalled()
    })
  })

  describe('idempotency (28/137)', () => {
    it('replays the SAME sighting on a repeated clientKey — never re-inserts, recomputes the estimate', async () => {
      mockedRepository.findSightingByClientKey.mockResolvedValue(sighting({ id: 900, reportId: 7 }))
      mockedRepository.findEstimateRows.mockResolvedValue([
        accRow({ direction: 'N', totalWeight: 3, sightingCount: 3 }),
      ])

      const result = await service.logDirectionSighting(INPUT, IDENTIFIED)

      expect(result).toEqual({ sightingId: 900, reportId: 7, estimate: 'N', count: 3, replayed: true })
      expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
      expect(mockedRepository.findReportForSighting).not.toHaveBeenCalled()
      expect(mockedGate).not.toHaveBeenCalled()
    })
  })

  describe('weighting (decisions 26/27/205) — weight decides the winner, never raw count', () => {
    it('an ANONYMOUS sighting is stored with a LOWER weight than an IDENTIFIED one (env defaults respected)', async () => {
      await service.logDirectionSighting(INPUT, IDENTIFIED)
      expect(mockedRepository.insertSighting).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 1.0 })
      )

      mockedRepository.findSightingByClientKey.mockResolvedValue(null)
      await service.logDirectionSighting({ ...INPUT, clientKey: OTHER_KEY }, ANONYMOUS)
      expect(mockedRepository.insertSighting).toHaveBeenLastCalledWith(
        expect.objectContaining({ weight: 0.5 })
      )
    })

    it('respects SIGHTING_WEIGHT_IDENTIFIED / SIGHTING_WEIGHT_ANONYMOUS env overrides', async () => {
      process.env.SIGHTING_WEIGHT_IDENTIFIED = '2'
      process.env.SIGHTING_WEIGHT_ANONYMOUS = '0.25'

      await service.logDirectionSighting(INPUT, IDENTIFIED)
      expect(mockedRepository.insertSighting).toHaveBeenCalledWith(expect.objectContaining({ weight: 2 }))

      mockedRepository.findSightingByClientKey.mockResolvedValue(null)
      await service.logDirectionSighting({ ...INPUT, clientKey: OTHER_KEY }, ANONYMOUS)
      expect(mockedRepository.insertSighting).toHaveBeenLastCalledWith(
        expect.objectContaining({ weight: 0.25 })
      )
    })

    it('3 anonymous sightings for direction A are OUTWEIGHED by 2 identified sightings for direction B — weight decides, not count', async () => {
      // 3 * 0.5 = 1.5 total for A vs 2 * 1.0 = 2.0 total for B.
      mockedRepository.findEstimateRows.mockResolvedValue([
        accRow({ direction: 'N', totalWeight: 1.5, sightingCount: 3, firstReportedAt: new Date('2026-09-04T10:00:00Z') }),
        accRow({ direction: 'S', totalWeight: 2.0, sightingCount: 2, firstReportedAt: new Date('2026-09-04T11:00:00Z') }),
      ])

      const result = await service.logDirectionSighting(INPUT, IDENTIFIED)

      expect(result.estimate).toBe('S')
    })
  })

  describe('floor (decision 202) — governs the synchronous write response NOT AT ALL (decision 22)', () => {
    it('the WRITE response returns the estimate/count on the VERY FIRST sighting, below any floor', async () => {
      mockedRepository.findEstimateRows.mockResolvedValue([accRow({ sightingCount: 1, totalWeight: 1 })])

      const result = await service.logDirectionSighting(INPUT, IDENTIFIED)

      expect(result.estimate).toBe('N')
      expect(result.count).toBe(1)
    })
  })

  it('checks the Legal Gate (location.tracking) BEFORE any insert — 451 blocks the whole flow', async () => {
    mockedGate.mockRejectedValue(
      new HttpError(451, 'Blocked for legal reasons in this jurisdiction', undefined, ErrorCodes.LEGAL_BLOCKED, {
        capability: Capabilities.LOCATION_TRACKING,
        reason: 'unreviewed',
      })
    )

    await expect(service.logDirectionSighting(INPUT, IDENTIFIED)).rejects.toMatchObject({
      statusCode: 451,
      code: ErrorCodes.LEGAL_BLOCKED,
    })
    expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
  })

  it('asserts location.tracking with the caller ref and ip', async () => {
    await service.logDirectionSighting(INPUT, IDENTIFIED)
    expect(mockedGate).toHaveBeenCalledWith(Capabilities.LOCATION_TRACKING, { userRef: '42', ip: IP })

    mockedRepository.findSightingByClientKey.mockResolvedValue(null)
    await service.logDirectionSighting({ ...INPUT, clientKey: OTHER_KEY }, ANONYMOUS)
    expect(mockedGate).toHaveBeenCalledWith(Capabilities.LOCATION_TRACKING, { userRef: undefined, ip: IP })
  })

  describe('accountability (decision 23)', () => {
    it('leaves a trail for an ANONYMOUS sighting, never blocking', async () => {
      const result = await service.logDirectionSighting(INPUT, ANONYMOUS)
      expect(mockedAccountability).toHaveBeenCalledWith('direction_sighting.log', IP, { sightingId: 501 })
      expect(result.sightingId).toBe(501)
    })

    it('leaves NO trail for an IDENTIFIED sighting — the session is the trail', async () => {
      await service.logDirectionSighting(INPUT, IDENTIFIED)
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('logs but never throws when the accountability write fails', async () => {
      const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined)
      mockedAccountability.mockRejectedValue(new Error('db down'))

      const result = await service.logDirectionSighting(INPUT, ANONYMOUS)

      expect(result.sightingId).toBe(501)
      expect(loggerSpy).toHaveBeenCalled()
      loggerSpy.mockRestore()
    })
  })
})
