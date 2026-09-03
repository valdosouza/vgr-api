import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports-queue.service'
import { ReportRow, ReportSearchRow } from '@modules/reports/reports.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

const ACTOR = 3
const NOW = new Date('2026-09-02T15:30:00.000Z')
const REVIEWED_AT = new Date('2026-09-02T10:00:00Z')

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
    category: 'missing',
    freeTag: null,
    subject: 'child',
    detailFields: null,
    lat: -23.551234,
    lng: -46.634567,
    anonymous: true,
    reporterAccountId: 42,
    status: 'open',
    resolvedAt: null,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
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
    createdAt: new Date('2026-08-03T12:34:56Z'),
    ...overrides,
  }
}

function searchRow(overrides: Partial<ReportSearchRow> = {}): ReportSearchRow {
  return {
    id: 7,
    category: 'missing',
    freeTag: null,
    subject: 'child',
    anonymous: true,
    status: 'open',
    frozen: false,
    purged: false,
    hidden: false,
    reviewed: false,
    lat: -23.551234,
    lng: -46.634567,
    mediaCount: 2,
    createdAt: new Date('2026-09-02T03:30:00.000Z'), // 12 h before NOW
    resolvedAt: null,
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

/** Everything a retention / lifecycle / moderation write would go
 *  through — reviewing must call NONE of it (161: not a moderation act). */
function expectOtherWritesUntouched(): void {
  expect(mockedRepository.markResolved).not.toHaveBeenCalled()
  expect(mockedRepository.freeze).not.toHaveBeenCalled()
  expect(mockedRepository.unfreeze).not.toHaveBeenCalled()
  expect(mockedRepository.hideReport).not.toHaveBeenCalled()
  expect(mockedRepository.unhideReport).not.toHaveBeenCalled()
  expect(mockedRepository.stampAttachedMediaExpiry).not.toHaveBeenCalled()
  expect(mockedRepository.setAttachedMediaFrozen).not.toHaveBeenCalled()
  expect(mockedRepository.purgeReport).not.toHaveBeenCalled()
  expect(mockedRepository.updateEditableFields).not.toHaveBeenCalled()
  expect(mockedRepository.appendTimelineEvent).not.toHaveBeenCalled()
}

describe('reports-queue.service — getModerationQueue (B3 — decision 161)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    mockedRepository.queueReports.mockResolvedValue({ rows: [], total: 0 })
  })

  it('resolves the tier -> category sets from shared/risk and passes them with the free-tag tier and the pagination', async () => {
    await service.getModerationQueue({ page: 2, pageSize: 10 }, NOW)

    expect(mockedRepository.queueReports).toHaveBeenCalledTimes(1)
    const [tiers, page, pageSize] = mockedRepository.queueReports.mock.calls[0]
    expect(page).toBe(2)
    expect(pageSize).toBe(10)
    expect(tiers.freeTagTier).toBe('medium')
    expect(tiers.tierCategories.high.sort()).toEqual(['kidnapping', 'missing'])
    expect(tiers.tierCategories.medium).toEqual([])
    // Every other category lands in low — nothing is dropped.
    const all = [
      ...tiers.tierCategories.high,
      ...tiers.tierCategories.medium,
      ...tiers.tierCategories.low,
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(tiers.tierCategories.low.length).toBeGreaterThan(0)
    expect(mockedTier).toHaveBeenCalledWith(null)
  })

  it('serves the B1 list item shape plus priority / hasMedia / ageHours; page and total pass through', async () => {
    mockedRepository.queueReports.mockResolvedValue({
      rows: [searchRow(), searchRow({ id: 8, category: 'assault', mediaCount: 0 })],
      total: 12,
    })

    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)

    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 12 })
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      reportId: 7,
      category: 'missing',
      subject: 'child',
      tier: 'high',
      status: 'open',
      frozen: false,
      purged: false,
      hidden: false,
      reviewed: false,
      mediaCount: 2,
      createdAt: '2026-09-02T03:30:00.000Z',
      resolvedAt: null,
      priority: 'high',
      hasMedia: true,
      ageHours: 12,
    })
    expect(page.items[1]).toMatchObject({
      reportId: 8,
      tier: 'low',
      priority: 'low',
      hasMedia: false,
    })
  })

  it('the position is DEGRADED by tier, exactly like the B1 list (135/159)', async () => {
    mockedRepository.queueReports.mockResolvedValue({ rows: [searchRow()], total: 1 })
    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)
    const position = page.items[0].position!
    expect(position).not.toBeNull()
    expect(position.lat).not.toBe(-23.551234)
    expect(position.lng).not.toBe(-46.634567)
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('-23.551234')
    expect(serialized).not.toContain('reporterAccountId')
    expect(serialized).not.toContain('clientKey')
  })

  it('a free-tag case takes the tier of getRiskTier(null) as its priority', async () => {
    mockedRepository.queueReports.mockResolvedValue({
      rows: [searchRow({ category: null, freeTag: 'lost dog' })],
      total: 1,
    })
    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)
    expect(page.items[0].priority).toBe('medium')
    expect(page.items[0].tier).toBe('medium')
  })

  it('ageHours is whole hours since created_at against the injected now (never negative)', async () => {
    mockedRepository.queueReports.mockResolvedValue({
      rows: [
        searchRow({ id: 1, createdAt: new Date('2026-09-02T15:29:59.000Z') }), // 1 s ago
        searchRow({ id: 2, createdAt: new Date('2026-09-02T13:31:00.000Z') }), // 1 h 59 min ago
        searchRow({ id: 3, createdAt: new Date('2026-08-30T15:30:00.000Z') }), // 3 days
        searchRow({ id: 4, createdAt: new Date('2026-09-02T15:31:00.000Z') }), // clock skew: in the future
      ],
      total: 4,
    })
    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)
    expect(page.items.map((item) => item.ageHours)).toEqual([0, 1, 72, 0])
  })

  it('a frozen case stays in the queue (161) and keeps its mark', async () => {
    mockedRepository.queueReports.mockResolvedValue({
      rows: [searchRow({ frozen: true })],
      total: 1,
    })
    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)
    expect(page.items).toHaveLength(1)
    expect(page.items[0].frozen).toBe(true)
  })

  it('the service never filters what the repository ordered — the WHERE/ORDER BY is the SQL contract', async () => {
    mockedRepository.queueReports.mockResolvedValue({
      rows: [searchRow({ id: 9, category: 'assault' }), searchRow({ id: 7 })],
      total: 2,
    })
    const page = await service.getModerationQueue({ page: 1, pageSize: 20 }, NOW)
    expect(page.items.map((item) => item.reportId)).toEqual([9, 7])
    expect(mockedRepository.searchReports).not.toHaveBeenCalled()
  })
})

describe('reports-queue.service — markReviewed (B3 — decisions 161/165)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([])
    mockedRepository.findOffersForPanel.mockResolvedValue([])
    mockedRepository.markReviewed.mockResolvedValue(true)
  })

  it('stamps the acting user and answers the refreshed B1 panel detail with reviewedAt / reviewedBy', async () => {
    mockedRepository.findById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ reviewedAt: REVIEWED_AT, reviewedBy: ACTOR }))

    const detail = await service.markReviewed(7, ACTOR)

    expect(mockedRepository.markReviewed).toHaveBeenCalledWith(7, ACTOR)
    expect(detail).toMatchObject({
      reportId: 7,
      reviewedAt: REVIEWED_AT.toISOString(),
      reviewedBy: ACTOR,
    })
    // The B1 detail, not a bespoke shape.
    expect(detail).toHaveProperty('timeline')
    expect(detail).toHaveProperty('media')
    expect(detail).toHaveProperty('offers')
    expect(detail).toHaveProperty('position')
  })

  it('does not touch hidden / frozen / expires_at nor any other write (161: not a moderation act)', async () => {
    mockedRepository.findById
      .mockResolvedValueOnce(row({ frozen: true, frozenReason: 'Writ 1', frozenAt: REVIEWED_AT }))
      .mockResolvedValueOnce(
        row({
          frozen: true,
          frozenReason: 'Writ 1',
          frozenAt: REVIEWED_AT,
          reviewedAt: REVIEWED_AT,
          reviewedBy: ACTOR,
        })
      )

    const detail = await service.markReviewed(7, ACTOR)

    expectOtherWritesUntouched()
    expect(detail.hidden).toBe(false)
    expect(detail.frozen).toBe(true)
    expect(detail.expiresAt).toBe('2026-12-01T00:00:00.000Z')
  })

  it('409 DUPLICATE when already reviewed — nothing written (idempotent-hostile)', async () => {
    mockedRepository.findById.mockResolvedValue(row({ reviewedAt: REVIEWED_AT, reviewedBy: 9 }))
    await expect(service.markReviewed(7, ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: ErrorCodes.DUPLICATE,
    })
    expect(mockedRepository.markReviewed).not.toHaveBeenCalled()
  })

  it('409 when the atomic UPDATE lost a race (0 rows affected)', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    mockedRepository.markReviewed.mockResolvedValue(false)
    await expect(service.markReviewed(7, ACTOR)).rejects.toMatchObject({
      statusCode: 409,
      code: ErrorCodes.DUPLICATE,
    })
  })

  it('404 when missing / soft-deleted / purged', async () => {
    mockedRepository.findById.mockResolvedValue(null)
    await expect(service.markReviewed(7, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
      code: ErrorCodes.NOT_FOUND,
    })

    mockedRepository.findById.mockResolvedValue(row({ purged: true, lat: null, lng: null }))
    await expect(service.markReviewed(7, ACTOR)).rejects.toMatchObject({ statusCode: 404 })
    expect(mockedRepository.markReviewed).not.toHaveBeenCalled()
  })

  it('a hidden case can still be marked reviewed (reviewing and moderation are independent marks)', async () => {
    mockedRepository.findById
      .mockResolvedValueOnce(row({ hidden: true, hiddenReasonCode: 'spam' }))
      .mockResolvedValueOnce(
        row({ hidden: true, hiddenReasonCode: 'spam', reviewedAt: REVIEWED_AT, reviewedBy: ACTOR })
      )
    const detail = await service.markReviewed(7, ACTOR)
    expect(detail.hidden).toBe(true)
    expect(detail.reviewedBy).toBe(ACTOR)
  })
})
