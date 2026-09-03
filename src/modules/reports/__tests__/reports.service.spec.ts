import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports.service'
import { ReportRow, SubmitReportInput } from '@modules/reports/reports.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { validateReportDetailFields } from '@shared/risk/category-form'
import { assertCapability } from '@shared/legal/legal-gate'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/risk/category-form')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>
const mockedValidate = validateReportDetailFields as jest.MockedFunction<
  typeof validateReportDetailFields
>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>

function input(overrides: Partial<SubmitReportInput> = {}): SubmitReportInput {
  return {
    clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
    category: 'missing',
    freeTag: null,
    subject: 'child',
    detailFields: null,
    lat: -23.55,
    lng: -46.63,
    anonymous: false,
    ...overrides,
  }
}

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
    category: 'missing',
    freeTag: null,
    subject: 'child',
    detailFields: null,
    lat: -23.55,
    lng: -46.63,
    anonymous: true,
    reporterAccountId: null,
    status: 'open',
    resolvedAt: null,
    expiresAt: null,
    frozen: false,
    frozenReason: null,
    frozenAt: null,
    purged: false,
    hidden: false,
    hiddenReasonCode: null,
    hiddenNote: null,
    hiddenAt: null,
    hiddenBy: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: new Date('2026-08-03T12:00:00Z'),
    ...overrides,
  }
}

describe('reports.service — SubmitReport (decisions 134-142)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findByClientKey.mockResolvedValue(null)
    mockedRepository.insertReport.mockResolvedValue(7)
    mockedValidate.mockResolvedValue([])
    mockedGate.mockResolvedValue({ allowed: true } as any)
  })

  it('anonymous (no account): gate consulted, account null, accountability logged', async () => {
    const result = await service.submitReport(input(), { accountId: null, ip: '10.0.0.1' })

    expect(result).toEqual({ reportId: 7, status: 'open', replayed: false })
    expect(mockedGate).toHaveBeenCalledWith('report.anonymous', {
      userRef: undefined,
      ip: '10.0.0.1',
    })
    expect(mockedRepository.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({ anonymous: true, reporterAccountId: null })
    )
    expect(mockedRepository.appendTimelineEvent).toHaveBeenCalledWith(7, 'created', null)
    expect(mockedAccountability).toHaveBeenCalledWith('report.submit', '10.0.0.1', { reportId: 7 })
  })

  it('authenticated, not anonymous: no gate, no accountability, account recorded', async () => {
    await service.submitReport(input(), { accountId: 42, ip: '10.0.0.1' })

    expect(mockedGate).not.toHaveBeenCalled()
    expect(mockedAccountability).not.toHaveBeenCalled()
    expect(mockedRepository.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({ anonymous: false, reporterAccountId: 42 })
    )
  })

  it('logged-in CHOOSING anonymity (decision 32): gated, flagged, account kept internally', async () => {
    await service.submitReport(input({ anonymous: true }), { accountId: 42, ip: '10.0.0.1' })

    expect(mockedGate).toHaveBeenCalledWith('report.anonymous', {
      userRef: '42',
      ip: '10.0.0.1',
    })
    // Social anonymity, forensic accountability (decision 23).
    expect(mockedRepository.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({ anonymous: true, reporterAccountId: 42 })
    )
  })

  it('jurisdiction block (451) stops before any write — fail-closed (decision 104)', async () => {
    mockedGate.mockRejectedValue(
      new HttpError(451, 'Blocked', undefined, ErrorCodes.LEGAL_BLOCKED)
    )
    await expect(
      service.submitReport(input(), { accountId: null, ip: '10.0.0.1' })
    ).rejects.toMatchObject({ statusCode: 451 })
    expect(mockedRepository.insertReport).not.toHaveBeenCalled()
    expect(mockedAccountability).not.toHaveBeenCalled()
  })

  it('replay returns the SAME report without re-judging anything (decision 137)', async () => {
    mockedRepository.findByClientKey.mockResolvedValue(row())

    const result = await service.submitReport(input(), { accountId: null, ip: '10.0.0.1' })

    expect(result).toEqual({ reportId: 7, status: 'open', replayed: true })
    expect(mockedGate).not.toHaveBeenCalled()
    expect(mockedRepository.insertReport).not.toHaveBeenCalled()
    expect(mockedAccountability).not.toHaveBeenCalled()
  })

  it('two replays racing: the losing insert resolves to the winner row', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' })
    mockedRepository.insertReport.mockRejectedValue(dup)
    mockedRepository.findByClientKey
      .mockResolvedValueOnce(null) // pre-insert check
      .mockResolvedValueOnce(row()) // post-collision fetch

    const result = await service.submitReport(input(), { accountId: null, ip: '10.0.0.1' })
    expect(result.replayed).toBe(true)
    expect(result.reportId).toBe(7)
  })

  it('detail fields failing the category schema (decision 47) reject with field codes', async () => {
    mockedValidate.mockResolvedValue(['last_seen is required'])

    const err = await service
      .submitReport(input(), { accountId: 42, ip: '10.0.0.1' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.statusCode).toBe(422)
    expect(err.fields[0].field).toBe('detailFields.last_seen')
    expect(mockedRepository.insertReport).not.toHaveBeenCalled()
  })

  it('free-tag submission skips the category schema entirely (decision 9)', async () => {
    await service.submitReport(input({ category: null, freeTag: 'algo novo' }), {
      accountId: 42,
      ip: '10.0.0.1',
    })
    expect(mockedValidate).not.toHaveBeenCalled()
  })

  it('an accountability write failure never takes the report down (decision 123)', async () => {
    mockedAccountability.mockRejectedValue(new Error('log db down'))
    const result = await service.submitReport(input(), { accountId: null, ip: '10.0.0.1' })
    expect(result.replayed).toBe(false)
    expect(result.reportId).toBe(7)
  })
})
