import * as repository from '@modules/reports/reports-stats.repository'
import * as service from '@modules/reports/reports-stats.service'
import { ReportStatsTotalsRow, StatsRange } from '@modules/reports/reports.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports-stats.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-02T15:30:00.000Z')

function totals(overrides: Partial<ReportStatsTotalsRow> = {}): ReportStatsTotalsRow {
  return {
    reports: 0,
    open: 0,
    resolved: 0,
    anonymous: 0,
    identified: 0,
    frozen: 0,
    hidden: 0,
    expired: 0,
    purged: 0,
    withMedia: 0,
    ...overrides,
  }
}

/** Tier table: missing/kidnapping high, free tag medium, rest low. */
function tierTable(): void {
  mockedTier.mockImplementation(async (category) => {
    if (category === null) return 'medium'
    if (category === 'missing' || category === 'kidnapping') return 'high'
    return 'low'
  })
}

function emptyRepository(): void {
  mockedRepository.countTotals.mockResolvedValue(totals())
  mockedRepository.countByPeriod.mockResolvedValue([])
  mockedRepository.countByCategory.mockResolvedValue([])
  mockedRepository.countBySubject.mockResolvedValue([])
  mockedRepository.countByStatus.mockResolvedValue([])
  mockedRepository.countHiddenByReason.mockResolvedValue([])
  mockedRepository.countBlockedMediaByReason.mockResolvedValue([])
}

async function expect422(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError)
    const httpError = err as HttpError
    expect(httpError.statusCode).toBe(422)
    expect(httpError.code).toBe(ErrorCodes.VALIDATION_FAILED)
    return httpError
  }
  throw new Error('expected a 422')
}

describe('reports-stats.service — range (decision 164, shares the B1 date rules)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    emptyRepository()
  })

  it('defaults: to = now (inclusive), from = to - 30 days, granularity as given', async () => {
    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    const expected: StatsRange = {
      from: new Date(NOW.getTime() - 30 * DAY_MS),
      to: NOW,
      toExclusive: false,
    }
    expect(mockedRepository.countTotals).toHaveBeenCalledWith(expected)
    expect(mockedRepository.countByPeriod).toHaveBeenCalledWith(expected, 'day')
    expect(result.range).toEqual({
      from: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
      to: NOW.toISOString(),
      granularity: 'day',
    })
  })

  it('a date-only `to` is exclusive at the next midnight UTC; date-only `from` starts at midnight', async () => {
    const result = await service.getReportStats(
      { from: '2026-08-01', to: '2026-08-31', granularity: 'week' },
      NOW
    )

    const expected: StatsRange = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-09-01T00:00:00.000Z'),
      toExclusive: true,
    }
    expect(mockedRepository.countByPeriod).toHaveBeenCalledWith(expected, 'week')
    expect(result.range).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      granularity: 'week',
    })
  })

  it('a date-time `to` is inclusive', async () => {
    await service.getReportStats(
      { from: '2026-08-01T10:00:00Z', to: '2026-08-02T10:00:00Z', granularity: 'month' },
      NOW
    )
    expect(mockedRepository.countTotals).toHaveBeenCalledWith({
      from: new Date('2026-08-01T10:00:00.000Z'),
      to: new Date('2026-08-02T10:00:00.000Z'),
      toExclusive: false,
    })
  })

  it('only `from` given: to = now', async () => {
    await service.getReportStats({ from: '2026-08-20', granularity: 'day' }, NOW)
    expect(mockedRepository.countTotals).toHaveBeenCalledWith({
      from: new Date('2026-08-20T00:00:00.000Z'),
      to: NOW,
      toExclusive: false,
    })
  })

  it('from > to is a 422 INVALID_VALUE on `from` — nothing is queried', async () => {
    const err = await expect422(
      service.getReportStats({ from: '2026-09-02', to: '2026-09-01', granularity: 'day' }, NOW)
    )
    expect(err.fields).toEqual([
      expect.objectContaining({ field: 'from', code: FieldErrorCodes.INVALID_VALUE }),
    ])
    expect(mockedRepository.countTotals).not.toHaveBeenCalled()
  })

  it('same-day date-only from/to is the whole day, not a 422', async () => {
    await service.getReportStats({ from: '2026-09-01', to: '2026-09-01', granularity: 'day' }, NOW)
    expect(mockedRepository.countTotals).toHaveBeenCalledWith({
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-02T00:00:00.000Z'),
      toExclusive: true,
    })
  })

  it('a range longer than 366 days is a 422 TOO_LONG on `to` with params.max = 366', async () => {
    const err = await expect422(
      service.getReportStats({ from: '2025-01-01', to: '2026-01-03', granularity: 'day' }, NOW)
    )
    expect(err.fields).toEqual([
      expect.objectContaining({
        field: 'to',
        code: FieldErrorCodes.TOO_LONG,
        params: { max: '366' },
      }),
    ])
    expect(mockedRepository.countTotals).not.toHaveBeenCalled()
  })

  it('exactly 366 days is accepted', async () => {
    // 2025-01-01 -> 2026-01-01 exclusive bound at 2026-01-02 = 366 days.
    await expect(
      service.getReportStats({ from: '2025-01-01', to: '2026-01-01', granularity: 'day' }, NOW)
    ).resolves.toBeDefined()
  })
})

describe('reports-stats.service — k = 5 floor on every count (decision 164)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    emptyRepository()
  })

  it('totals: 0 stays 0, 1..4 becomes "<5", >= 5 stays the number', async () => {
    mockedRepository.countTotals.mockResolvedValue(
      totals({
        reports: 12,
        open: 5,
        resolved: 7,
        anonymous: 4,
        identified: 8,
        frozen: 1,
        hidden: 0,
        expired: 3,
        purged: 2,
        withMedia: 6,
      })
    )

    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    expect(result.totals).toEqual({
      reports: 12,
      open: 5,
      resolved: 7,
      anonymous: '<5',
      identified: 8,
      frozen: '<5',
      hidden: 0,
      expired: '<5',
      purged: '<5',
      withMedia: 6,
    })
  })

  it('byTier is summed from byCategory BEFORE flooring; byCategory rows are floored individually', async () => {
    mockedRepository.countByCategory.mockResolvedValue([
      { category: 'missing', reports: 3 },
      { category: 'kidnapping', reports: 3 },
      { category: 'assault', reports: 4 },
      { category: null, reports: 2 },
    ])

    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    expect(result.byCategory).toEqual([
      { category: 'missing', tier: 'high', reports: '<5' },
      { category: 'kidnapping', tier: 'high', reports: '<5' },
      { category: 'assault', tier: 'low', reports: '<5' },
      { category: null, tier: 'medium', reports: '<5' },
    ])
    // 3 + 3 = 6 >= 5 -> the tier IS served, while each category is not.
    expect(result.byTier).toEqual([
      { tier: 'low', reports: '<5' },
      { tier: 'medium', reports: '<5' },
      { tier: 'high', reports: 6 },
    ])
  })

  it('free-tag reports (category null) sit at getRiskTier(null)', async () => {
    mockedRepository.countByCategory.mockResolvedValue([{ category: null, reports: 9 }])

    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    expect(mockedTier).toHaveBeenCalledWith(null)
    expect(result.byCategory).toEqual([{ category: null, tier: 'medium', reports: 9 }])
    expect(result.byTier).toEqual([
      { tier: 'low', reports: 0 },
      { tier: 'medium', reports: 9 },
      { tier: 'high', reports: 0 },
    ])
  })

  it('byPeriod / bySubject / byStatus / moderation groups are floored and passed through in order', async () => {
    mockedRepository.countByPeriod.mockResolvedValue([
      { period: '2026-08-01', reports: 1 },
      { period: '2026-08-02', reports: 5 },
    ])
    mockedRepository.countBySubject.mockResolvedValue([
      { subject: 'child', reports: 4 },
      { subject: 'adult', reports: 10 },
    ])
    mockedRepository.countByStatus.mockResolvedValue([
      { status: 'open', reports: 2 },
      { status: 'resolved', reports: 20 },
    ])
    mockedRepository.countHiddenByReason.mockResolvedValue([
      { reasonCode: 'spam', reports: 6 },
      { reasonCode: 'abuse', reports: 1 },
    ])
    mockedRepository.countBlockedMediaByReason.mockResolvedValue([
      { reasonCode: 'personal_data', media: 3 },
    ])

    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    expect(result.byPeriod).toEqual([
      { period: '2026-08-01', reports: '<5' },
      { period: '2026-08-02', reports: 5 },
    ])
    expect(result.bySubject).toEqual([
      { subject: 'child', reports: '<5' },
      { subject: 'adult', reports: 10 },
    ])
    expect(result.byStatus).toEqual([
      { status: 'open', reports: '<5' },
      { status: 'resolved', reports: 20 },
    ])
    expect(result.moderation).toEqual({
      hiddenByReason: [
        { reasonCode: 'spam', reports: 6 },
        { reasonCode: 'abuse', reports: '<5' },
      ],
      blockedMediaByReason: [{ reasonCode: 'personal_data', media: '<5' }],
    })
  })

  it('the response is aggregates only — no ids, positions or identities anywhere (164/135/23)', async () => {
    mockedRepository.countTotals.mockResolvedValue(totals({ reports: 7, open: 7 }))
    mockedRepository.countByCategory.mockResolvedValue([{ category: 'assault', reports: 7 }])

    const result = await service.getReportStats({ granularity: 'day' }, NOW)

    const keys = new Set<string>()
    JSON.stringify(result, (key, value) => {
      if (key) keys.add(key)
      return value
    })
    for (const forbidden of [
      'id',
      'reportId',
      'lat',
      'lng',
      'position',
      'accountId',
      'reporterAccountId',
      'clientKey',
      'displayName',
    ]) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })
})
