import request from 'supertest'
import { randomUUID } from 'crypto'
import app from '../../../app'
import * as repository from '@modules/reports/reports.repository'
import { assertCapability } from '@shared/legal/legal-gate'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { validateReportDetailFields } from '@shared/risk/category-form'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/legal/legal-gate')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/risk/category-form')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedValidate = validateReportDetailFields as jest.MockedFunction<
  typeof validateReportDetailFields
>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>

function body(overrides: Record<string, unknown> = {}) {
  return {
    clientKey: randomUUID(),
    category: 'missing',
    subject: 'child',
    position: { lat: -23.55, lng: -46.63 },
    ...overrides,
  }
}

describe('POST /app-reports (R1 — anonymous end-to-end)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    jest.resetAllMocks()
    mockedRepository.findByClientKey.mockResolvedValue(null)
    mockedRepository.insertReport.mockResolvedValue(11)
    mockedValidate.mockResolvedValue([])
    mockedGate.mockResolvedValue({ allowed: true } as any)
    mockedAccountability.mockResolvedValue()
  })

  it('accepts a bare anonymous submission — no token, no friction (decisions 32/123)', async () => {
    const res = await request(app).post('/app-reports').send(body())
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ reportId: 11, status: 'open' })
    expect(mockedGate).toHaveBeenCalled()
  })

  it('answers 200 (not 201) on an offline-queue replay (decision 137)', async () => {
    mockedRepository.findByClientKey.mockResolvedValue({
      id: 11,
      status: 'open',
    } as any)
    const res = await request(app).post('/app-reports').send(body())
    expect(res.status).toBe(200)
    expect(res.body.reportId).toBe(11)
  })

  it('surfaces the jurisdiction block as 451 with the stable code (decision 104)', async () => {
    mockedGate.mockRejectedValue(
      new HttpError(451, 'Blocked', undefined, ErrorCodes.LEGAL_BLOCKED, {
        capability: 'report.anonymous',
        reason: 'no_control',
      })
    )
    const res = await request(app).post('/app-reports').send(body())
    expect(res.status).toBe(451)
    expect(res.body.code).toBe('LEGAL_BLOCKED')
  })

  it('rejects category AND freeTag together — the XOR of decision 9', async () => {
    const res = await request(app)
      .post('/app-reports')
      .send(body({ freeTag: 'também' }))
    expect(res.status).toBe(422)
    expect(res.body.fields.some((f: any) => f.field === 'category')).toBe(true)
    expect(mockedRepository.insertReport).not.toHaveBeenCalled()
  })

  it('rejects a missing subject — the mandatory second axis of decision 140', async () => {
    const { subject: _dropped, ...rest } = body()
    const res = await request(app).post('/app-reports').send(rest)
    expect(res.status).toBe(422)
    expect(res.body.fields.some((f: any) => f.field === 'subject')).toBe(true)
  })

  it('a PRESENT but invalid token fails 401 instead of downgrading to anonymous', async () => {
    const res = await request(app)
      .post('/app-reports')
      .set('Authorization', 'Bearer forged')
      .send(body())
    expect(res.status).toBe(401)
    expect(mockedRepository.insertReport).not.toHaveBeenCalled()
  })
})
