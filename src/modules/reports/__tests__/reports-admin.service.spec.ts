import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports-admin.service'
import { ReportRow, ReportSearchRow } from '@modules/reports/reports.interface'
import { getRiskTier } from '@shared/risk/risk-tier'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
    category: 'missing',
    freeTag: null,
    subject: 'child',
    detailFields: { name: 'Ana' },
    lat: -23.551234,
    lng: -46.634567,
    anonymous: true,
    reporterAccountId: 42, // kept internally (decision 23) — must never surface
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
    createdAt: new Date('2026-08-03T12:34:56Z'),
    resolvedAt: null,
    ...overrides,
  }
}

/** Tier table for the tests: two high categories, free tag medium, rest low. */
function tierTable(): void {
  mockedTier.mockImplementation(async (category) => {
    if (category === null) return 'medium'
    if (category === 'missing' || category === 'kidnapping') return 'high'
    return 'low'
  })
}

describe('reports-admin.service — search (decisions 159/166)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    mockedRepository.searchReports.mockResolvedValue({ rows: [], total: 0 })
  })

  it('passes plain filters and pagination through, sorted by the repository', async () => {
    const result = await service.searchReports({
      page: 2,
      pageSize: 10,
      id: 7,
      status: 'open',
      category: 'assault',
      subject: 'adult',
      frozen: true,
      hasMedia: false,
    })

    expect(result).toEqual({ items: [], page: 2, pageSize: 10, total: 0 })
    expect(mockedRepository.searchReports).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        status: 'open',
        category: 'assault',
        subject: 'adult',
        frozen: true,
        hasMedia: false,
      }),
      2,
      10
    )
  })

  it('tier=high resolves to the categories currently in that tier (shared/risk)', async () => {
    await service.searchReports({ page: 1, pageSize: 20, tier: 'high' })

    const filters = mockedRepository.searchReports.mock.calls[0][0]
    expect(filters.categories).toEqual(['missing', 'kidnapping'])
    expect(filters.includeFreeTag).toBe(false)
  })

  it('tier=medium includes free-tag rows (getRiskTier(null) is medium)', async () => {
    await service.searchReports({ page: 1, pageSize: 20, tier: 'medium' })

    const filters = mockedRepository.searchReports.mock.calls[0][0]
    expect(filters.categories).toEqual([])
    expect(filters.includeFreeTag).toBe(true)
  })

  it('date-only bounds: from inclusive at midnight UTC, to exclusive +1 day', async () => {
    await service.searchReports({ page: 1, pageSize: 20, from: '2026-08-01', to: '2026-08-03' })

    const filters = mockedRepository.searchReports.mock.calls[0][0]
    expect(filters.createdFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    expect(filters.createdTo).toEqual(new Date('2026-08-04T00:00:00.000Z'))
    expect(filters.createdToExclusive).toBe(true)
  })

  it('ISO date-time bounds are used as given (to inclusive)', async () => {
    await service.searchReports({
      page: 1,
      pageSize: 20,
      from: '2026-08-01T10:00:00Z',
      to: '2026-08-01T12:00:00Z',
    })

    const filters = mockedRepository.searchReports.mock.calls[0][0]
    expect(filters.createdFrom).toEqual(new Date('2026-08-01T10:00:00.000Z'))
    expect(filters.createdTo).toEqual(new Date('2026-08-01T12:00:00.000Z'))
    expect(filters.createdToExclusive).toBe(false)
  })

  it('list items carry the DEGRADED position and no identity (decisions 135/160)', async () => {
    mockedRepository.searchReports.mockResolvedValue({
      rows: [searchRow(), searchRow({ id: 8, category: null, freeTag: 'loud party', mediaCount: 0 })],
      total: 2,
    })

    const result = await service.searchReports({ page: 1, pageSize: 20 })

    expect(result.total).toBe(2)
    expect(result.items[0]).toEqual({
      reportId: 7,
      category: 'missing',
      freeTag: null,
      subject: 'child',
      tier: 'high',
      status: 'open',
      anonymous: true,
      frozen: false,
      purged: false,
      hidden: false,
      reviewed: false,
      mediaCount: 2,
      position: { lat: -23.55, lng: -46.63 }, // high tier grid 0.01
      createdAt: '2026-08-03T12:34:56.000Z',
      resolvedAt: null,
    })
    expect(result.items[1].tier).toBe('medium')
    expect(result.items[1].position).toEqual({ lat: -23.55, lng: -46.635 })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('reporterAccountId')
    expect(serialized).not.toContain('clientKey')
    expect(serialized).not.toContain('-23.551234')
  })

  it('purged rows stay in the list as a skeleton with position null (decisions 25/131)', async () => {
    mockedRepository.searchReports.mockResolvedValue({
      rows: [searchRow({ purged: true, lat: null, lng: null, status: 'resolved', resolvedAt: new Date('2026-08-10T00:00:00Z') })],
      total: 1,
    })

    const result = await service.searchReports({ page: 1, pageSize: 20 })

    expect(result.items[0].purged).toBe(true)
    expect(result.items[0].position).toBeNull()
    expect(result.items[0].resolvedAt).toBe('2026-08-10T00:00:00.000Z')
  })
})

describe('reports-admin.service — detail (decisions 159/160/166)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    mockedRepository.getTimeline.mockResolvedValue([
      { eventType: 'created', payload: null, createdAt: new Date('2026-08-03T12:34:56Z') },
    ])
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([
      { publicId: 'aaaaaaaa-0000-4000-8000-000000000001', mime: 'image/webp', width: 10, height: 10, status: 'available', blockedReasonCode: null, blockedNote: null, blockedAt: null },
      { publicId: 'aaaaaaaa-0000-4000-8000-000000000002', mime: 'image/webp', width: 10, height: 10, status: 'blocked', blockedReasonCode: null, blockedNote: null, blockedAt: null },
    ])
    mockedRepository.findOffersForPanel.mockResolvedValue([
      { id: 1, helpType: 'share', anonymous: true, helperAccountId: 99, helperDisplayName: 'Hidden', createdAt: new Date('2026-08-04T00:00:00Z') },
      { id: 2, helpType: 'relay_information', anonymous: false, helperAccountId: 100, helperDisplayName: 'Bruno', createdAt: new Date('2026-08-05T00:00:00Z') },
    ])
    mockedRepository.findAccountDisplayName.mockResolvedValue('Ana Reporter')
  })

  it('anonymous report: reporter null and NO identity field anywhere (decision 160)', async () => {
    mockedRepository.findById.mockResolvedValue(row())

    const detail = await service.getReportPanelDetail(7)

    expect(detail.reporter).toBeNull()
    expect(mockedRepository.findAccountDisplayName).not.toHaveBeenCalled()
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain('reporterAccountId')
    expect(serialized).not.toContain('clientKey')
    expect(serialized).not.toContain('42')
    expect(serialized).not.toContain('@')
  })

  it('identified report: only { accountId, displayName } (decision 160)', async () => {
    mockedRepository.findById.mockResolvedValue(row({ anonymous: false }))

    const detail = await service.getReportPanelDetail(7)

    expect(detail.reporter).toEqual({ accountId: 42, displayName: 'Ana Reporter' })
    expect(mockedRepository.findAccountDisplayName).toHaveBeenCalledWith(42)
  })

  it('position is degraded by tier with the grid precision; the exact value never appears (159)', async () => {
    mockedRepository.findById.mockResolvedValue(row())

    const detail = await service.getReportPanelDetail(7)

    expect(detail.position).toEqual({ lat: -23.55, lng: -46.63, precisionMeters: 1100 })
    expect(JSON.stringify(detail)).not.toContain('-23.551234')
  })

  it('low-tier precision is ~110 m', async () => {
    mockedRepository.findById.mockResolvedValue(row({ category: 'assault' }))
    const detail = await service.getReportPanelDetail(7)
    expect(detail.tier).toBe('low')
    expect(detail.position).toEqual({ lat: -23.551, lng: -46.635, precisionMeters: 110 })
  })

  it('serves the full case: exact timestamps, detail fields, timeline, media with status, offers', async () => {
    mockedRepository.findById.mockResolvedValue(
      row({ frozen: true, frozenReason: 'Writ 1', frozenAt: new Date('2026-08-06T00:00:00Z') })
    )

    const detail = await service.getReportPanelDetail(7)

    expect(detail).toMatchObject({
      reportId: 7,
      category: 'missing',
      freeTag: null,
      subject: 'child',
      tier: 'high',
      status: 'open',
      anonymous: true,
      frozen: true,
      frozenReason: 'Writ 1',
      frozenAt: '2026-08-06T00:00:00.000Z',
      purged: false,
      createdAt: '2026-08-03T12:34:56.000Z', // exact — the panel is the platform (60)
      resolvedAt: null,
      expiresAt: null,
      detailFields: { name: 'Ana' },
      timeline: [{ eventType: 'created', payload: null, createdAt: '2026-08-03T12:34:56.000Z' }],
    })
    expect(detail.media).toEqual([
      { publicId: 'aaaaaaaa-0000-4000-8000-000000000001', mime: 'image/webp', width: 10, height: 10, status: 'available', blockedReasonCode: null, blockedNote: null, blockedAt: null },
      { publicId: 'aaaaaaaa-0000-4000-8000-000000000002', mime: 'image/webp', width: 10, height: 10, status: 'blocked', blockedReasonCode: null, blockedNote: null, blockedAt: null },
    ])
  })

  it('offers: anonymous helper -> null, identified -> { accountId, displayName }, no tier degradation', async () => {
    mockedRepository.findById.mockResolvedValue(row())

    const detail = await service.getReportPanelDetail(7)

    expect(detail.offers).toEqual([
      { helpOfferId: 1, helpType: 'share', anonymous: true, helper: null, createdAt: '2026-08-04T00:00:00.000Z' },
      {
        helpOfferId: 2,
        helpType: 'relay_information',
        anonymous: false,
        helper: { accountId: 100, displayName: 'Bruno' },
        createdAt: '2026-08-05T00:00:00.000Z',
      },
    ])
    expect(JSON.stringify(detail.offers)).not.toContain('Hidden')
    expect(JSON.stringify(detail.offers)).not.toContain('99')
  })

  it('purged case returns the statistical skeleton only (decisions 25/131)', async () => {
    mockedRepository.findById.mockResolvedValue(
      row({
        purged: true,
        lat: null,
        lng: null,
        detailFields: null,
        freeTag: null,
        status: 'resolved',
        resolvedAt: new Date('2026-08-10T00:00:00Z'),
        expiresAt: new Date('2026-11-08T00:00:00Z'),
      })
    )

    const detail = await service.getReportPanelDetail(7)

    expect(detail).toMatchObject({
      reportId: 7,
      category: 'missing',
      subject: 'child',
      tier: 'high',
      status: 'resolved',
      purged: true,
      position: null,
      detailFields: null,
      timeline: [],
      media: [],
      offers: [],
      reporter: null,
      resolvedAt: '2026-08-10T00:00:00.000Z',
    })
    expect(mockedRepository.getTimeline).not.toHaveBeenCalled()
    expect(mockedRepository.findOffersForPanel).not.toHaveBeenCalled()
  })

  it('404 when the report is missing or soft-deleted', async () => {
    mockedRepository.findById.mockResolvedValue(null)
    await expect(service.getReportPanelDetail(404)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('reports-admin.service — exact position (decision 159)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
  })

  it('returns the EXACT position for the grant-holding, audited flow', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    await expect(service.getReportExactPosition(7)).resolves.toEqual({
      reportId: 7,
      lat: -23.551234,
      lng: -46.634567,
    })
  })

  it('404 when purged (position already nulled) or missing', async () => {
    mockedRepository.findById.mockResolvedValue(row({ purged: true, lat: null, lng: null }))
    await expect(service.getReportExactPosition(7)).rejects.toMatchObject({ statusCode: 404 })

    mockedRepository.findById.mockResolvedValue(null)
    await expect(service.getReportExactPosition(8)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reports-admin.service — B3 review surfaces on search and detail (decision 161)', () => {
  const REVIEWED_AT = new Date('2026-09-02T10:00:00Z')

  beforeEach(() => {
    jest.resetAllMocks()
    tierTable()
    mockedRepository.searchReports.mockResolvedValue({ rows: [], total: 0 })
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersForPanel.mockResolvedValue([])
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([])
  })

  it('search passes the reviewed filter through to the repository', async () => {
    await service.searchReports({ page: 1, pageSize: 20, reviewed: false })
    expect(mockedRepository.searchReports).toHaveBeenCalledWith(
      expect.objectContaining({ reviewed: false }),
      1,
      20
    )
  })

  it('list items carry the reviewed mark', async () => {
    mockedRepository.searchReports.mockResolvedValue({
      rows: [searchRow({ reviewed: true }), searchRow({ id: 8 })],
      total: 2,
    })
    const page = await service.searchReports({ page: 1, pageSize: 20 })
    expect(page.items[0].reviewed).toBe(true)
    expect(page.items[1].reviewed).toBe(false)
  })

  it('detail exposes reviewedAt (ISO) and reviewedBy — also on the purged skeleton (tb_report columns)', async () => {
    mockedRepository.findById.mockResolvedValue(row({ reviewedAt: REVIEWED_AT, reviewedBy: 3 }))
    const detail = await service.getReportPanelDetail(7)
    expect(detail).toMatchObject({ reviewedAt: REVIEWED_AT.toISOString(), reviewedBy: 3 })

    mockedRepository.findById.mockResolvedValue(
      row({ purged: true, lat: null, lng: null, reviewedAt: REVIEWED_AT, reviewedBy: 3 })
    )
    const skeleton = await service.getReportPanelDetail(7)
    expect(skeleton).toMatchObject({ purged: true, reviewedAt: REVIEWED_AT.toISOString(), reviewedBy: 3 })
  })

  it('detail of an unreviewed case carries null review fields', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    const detail = await service.getReportPanelDetail(7)
    expect(detail).toMatchObject({ reviewedAt: null, reviewedBy: null })
  })
})
