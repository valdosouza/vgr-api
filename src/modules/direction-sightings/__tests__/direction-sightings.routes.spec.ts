import request from 'supertest'
import app from '../../../app'
import * as repository from '@modules/direction-sightings/direction-sightings.repository'
import * as accountRepository from '@modules/accounts/account.repository'
import { DirectionSightingRow, ReportForSightingRow } from '@modules/direction-sightings/direction-sightings.interface'
import { DirectionAccumulatorRow } from '@shared/direction-sighting/direction-estimate'
import { signAppAccessToken } from '@shared/auth/app-session'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/direction-sightings/direction-sightings.repository')
jest.mock('@modules/accounts/account.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
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

function report(overrides: Partial<ReportForSightingRow> = {}): ReportForSightingRow {
  return { id: 7, reporterAccountId: 99, status: 'open', category: 'robbery', ...overrides }
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

const identifiedToken = () => `Bearer ${signAppAccessToken(42, 1)}`

describe('/app-direction-sightings routes (DS1 — decisions 200-207)', () => {
  const BODY = { reportId: 7, direction: 'N', clientKey: CLIENT_KEY }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedAccounts.findAccountById.mockImplementation(async (id) => account(id))
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
    mockedRepository.findSightingByClientKey.mockResolvedValue(null)
    mockedRepository.findReportForSighting.mockResolvedValue(report())
    mockedRepository.insertSighting.mockResolvedValue(sighting())
    mockedRepository.findEstimateRows.mockResolvedValue([accRow()])
  })

  it('201s for an ANONYMOUS caller — no token required (decision 200)', async () => {
    const res = await request(app).post('/app-direction-sightings').send(BODY)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ sightingId: 501, reportId: 7, estimate: 'N', count: 1 })
    expect(res.body).not.toHaveProperty('replayed')
    expect(mockedAccountability).toHaveBeenCalledWith('direction_sighting.log', expect.any(String), {
      sightingId: 501,
    })
  })

  it('201s for an IDENTIFIED caller — leaves no accountability entry', async () => {
    mockedRepository.insertSighting.mockResolvedValue(sighting({ accountId: 42 }))

    const res = await request(app)
      .post('/app-direction-sightings')
      .set('Authorization', identifiedToken())
      .send(BODY)

    expect(res.status).toBe(201)
    expect(mockedRepository.insertSighting).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 42, weight: 1.0 })
    )
    expect(mockedAccountability).not.toHaveBeenCalled()
  })

  it('200s with the SAME sighting on a clientKey replay — never re-inserts', async () => {
    mockedRepository.findSightingByClientKey.mockResolvedValue(sighting({ id: 900 }))
    mockedRepository.findEstimateRows.mockResolvedValue([accRow({ sightingCount: 3, totalWeight: 3 })])

    const res = await request(app).post('/app-direction-sightings').send(BODY)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sightingId: 900, reportId: 7, estimate: 'N', count: 3 })
    expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
  })

  it('404s when the report does not exist', async () => {
    mockedRepository.findReportForSighting.mockResolvedValue(null)
    const res = await request(app).post('/app-direction-sightings').send(BODY)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe(ErrorCodes.NOT_FOUND)
  })

  it('422 DIRECTION_SIGHTING_NOT_ELIGIBLE for an ineligible category', async () => {
    mockedRepository.findReportForSighting.mockResolvedValue(report({ category: 'assault' }))
    const res = await request(app).post('/app-direction-sightings').send(BODY)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe(ErrorCodes.DIRECTION_SIGHTING_NOT_ELIGIBLE)
  })

  it('422 BUSINESS_RULE for a resolved report', async () => {
    mockedRepository.findReportForSighting.mockResolvedValue(report({ status: 'resolved' }))
    const res = await request(app).post('/app-direction-sightings').send(BODY)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe(ErrorCodes.BUSINESS_RULE)
  })

  it('422 BUSINESS_RULE when the IDENTIFIED reporter sights their own report', async () => {
    mockedRepository.findReportForSighting.mockResolvedValue(report({ reporterAccountId: 42 }))
    const res = await request(app)
      .post('/app-direction-sightings')
      .set('Authorization', identifiedToken())
      .send(BODY)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe(ErrorCodes.BUSINESS_RULE)
  })

  it('451 LEGAL_BLOCKED before any insert', async () => {
    mockedGate.mockRejectedValue(
      new HttpError(451, 'Blocked for legal reasons in this jurisdiction', undefined, ErrorCodes.LEGAL_BLOCKED, {
        capability: 'location.tracking',
        reason: 'unreviewed',
      })
    )
    const res = await request(app).post('/app-direction-sightings').send(BODY)
    expect(res.status).toBe(451)
    expect(res.body.code).toBe(ErrorCodes.LEGAL_BLOCKED)
    expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
  })

  it('422 VALIDATION_FAILED for a malformed body', async () => {
    const badDirection = await request(app)
      .post('/app-direction-sightings')
      .send({ ...BODY, direction: 'NNE' })
    const badKey = await request(app).post('/app-direction-sightings').send({ ...BODY, clientKey: 'not-a-uuid' })
    const missingReport = await request(app)
      .post('/app-direction-sightings')
      .send({ direction: 'N', clientKey: CLIENT_KEY })

    expect(badDirection.status).toBe(422)
    expect(badDirection.body.code).toBe(ErrorCodes.VALIDATION_FAILED)
    expect(badKey.status).toBe(422)
    expect(missingReport.status).toBe(422)
  })

  it('a PRESENT but invalid app token is 401, never silently downgraded to anonymous', async () => {
    const res = await request(app)
      .post('/app-direction-sightings')
      .set('Authorization', 'Bearer forged')
      .send(BODY)
    expect(res.status).toBe(401)
  })

  it('is never mounted under /api', async () => {
    const res = await request(app).post('/api/app-direction-sightings').send(BODY)
    expect(res.status).not.toBe(201)
    expect(mockedRepository.insertSighting).not.toHaveBeenCalled()
  })
})
