import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports-admin.service'
import { ReportRow, ReportSearchRow } from '@modules/reports/reports.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/risk/risk-tier')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>

const ACTOR = 3
const HIDDEN_AT = new Date('2026-09-02T10:00:00Z')

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: '3f9d1c2e-0000-4000-8000-000000000001',
    category: 'assault',
    freeTag: null,
    subject: 'adult',
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
    createdAt: new Date('2026-08-03T12:34:56Z'),
    ...overrides,
  }
}

function hiddenRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return row({
    hidden: true,
    hiddenReasonCode: 'spam',
    hiddenNote: null,
    hiddenAt: HIDDEN_AT,
    hiddenBy: ACTOR,
    ...overrides,
  })
}

function searchRow(overrides: Partial<ReportSearchRow> = {}): ReportSearchRow {
  return {
    id: 7,
    category: 'assault',
    freeTag: null,
    subject: 'adult',
    anonymous: true,
    status: 'open',
    frozen: false,
    purged: false,
    hidden: false,
    lat: -23.551234,
    lng: -46.634567,
    mediaCount: 0,
    createdAt: new Date('2026-08-03T12:34:56Z'),
    resolvedAt: null,
    ...overrides,
  }
}

/** Everything a retention/lifecycle write would go through — moderation
 *  must call NONE of it (decisions 162/167). */
function expectRetentionUntouched(): void {
  expect(mockedRepository.markResolved).not.toHaveBeenCalled()
  expect(mockedRepository.unfreeze).not.toHaveBeenCalled()
  expect(mockedRepository.freeze).not.toHaveBeenCalled()
  expect(mockedRepository.stampAttachedMediaExpiry).not.toHaveBeenCalled()
  expect(mockedRepository.setAttachedMediaFrozen).not.toHaveBeenCalled()
  expect(mockedRepository.purgeReport).not.toHaveBeenCalled()
  expect(mockedRepository.updateEditableFields).not.toHaveBeenCalled()
  expect(mockedRepository.appendTimelineEvent).not.toHaveBeenCalled()
}

describe('reports-admin.service — hide / unhide (B2 — decisions 162/163/167)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([])
    mockedRepository.findOffersForPanel.mockResolvedValue([])
    mockedRepository.hideReport.mockResolvedValue(true)
    mockedRepository.unhideReport.mockResolvedValue(true)
  })

  describe('hideReport', () => {
    it('hides with a catalog code and the acting user; answers the refreshed panel detail', async () => {
      mockedRepository.findById.mockResolvedValueOnce(row()).mockResolvedValueOnce(hiddenRow())

      const detail = await service.hideReport(7, { reasonCode: 'spam' }, ACTOR)

      expect(mockedRepository.hideReport).toHaveBeenCalledWith(7, 'spam', null, ACTOR)
      expect(detail).toMatchObject({
        reportId: 7,
        hidden: true,
        hiddenReasonCode: 'spam',
        hiddenNote: null,
        hiddenAt: HIDDEN_AT.toISOString(),
        hiddenBy: ACTOR,
      })
    })

    it('stores the note when given', async () => {
      mockedRepository.findById
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(hiddenRow({ hiddenReasonCode: 'other', hiddenNote: 'doxxing' }))

      const detail = await service.hideReport(7, { reasonCode: 'other', note: 'doxxing' }, ACTOR)

      expect(mockedRepository.hideReport).toHaveBeenCalledWith(7, 'other', 'doxxing', ACTOR)
      expect(detail.hiddenNote).toBe('doxxing')
    })

    it('never touches retention, freeze or the timeline (162/167)', async () => {
      mockedRepository.findById.mockResolvedValueOnce(row()).mockResolvedValueOnce(hiddenRow())

      const detail = await service.hideReport(7, { reasonCode: 'abuse' }, ACTOR)

      expectRetentionUntouched()
      // expires_at as it was before the act — the clock is not moderation's.
      expect(detail.expiresAt).toBe('2026-12-01T00:00:00.000Z')
      expect(detail.frozen).toBe(false)
    })

    it('409 DUPLICATE when already hidden — nothing written', async () => {
      mockedRepository.findById.mockResolvedValue(hiddenRow())
      await expect(service.hideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.DUPLICATE,
      })
      expect(mockedRepository.hideReport).not.toHaveBeenCalled()
    })

    it('409 when the atomic transition lost a race (0 rows affected)', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      mockedRepository.hideReport.mockResolvedValue(false)
      await expect(service.hideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.DUPLICATE,
      })
    })

    it('404 when missing / soft-deleted / purged', async () => {
      mockedRepository.findById.mockResolvedValue(null)
      await expect(service.hideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      })

      mockedRepository.findById.mockResolvedValue(row({ purged: true, lat: null, lng: null }))
      await expect(service.hideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 404,
      })
      expect(mockedRepository.hideReport).not.toHaveBeenCalled()
    })

    it('hidden and frozen are independent — a frozen case can be hidden', async () => {
      mockedRepository.findById
        .mockResolvedValueOnce(row({ frozen: true, frozenReason: 'Writ 1', frozenAt: HIDDEN_AT }))
        .mockResolvedValueOnce(
          hiddenRow({ frozen: true, frozenReason: 'Writ 1', frozenAt: HIDDEN_AT })
        )

      const detail = await service.hideReport(7, { reasonCode: 'spam' }, ACTOR)

      expect(detail.frozen).toBe(true)
      expect(detail.hidden).toBe(true)
      expect(mockedRepository.unfreeze).not.toHaveBeenCalled()
    })
  })

  describe('unhideReport', () => {
    it('reverts under the SAME single-human rule (162 — no dual control) and clears the mark', async () => {
      mockedRepository.findById.mockResolvedValueOnce(hiddenRow()).mockResolvedValueOnce(row())

      const detail = await service.unhideReport(
        7,
        { reasonCode: 'other', note: 'appeal upheld' },
        ACTOR
      )

      expect(mockedRepository.unhideReport).toHaveBeenCalledWith(7)
      expect(detail).toMatchObject({
        hidden: false,
        hiddenReasonCode: null,
        hiddenNote: null,
        hiddenAt: null,
        hiddenBy: null,
      })
      expectRetentionUntouched()
    })

    it('409 DUPLICATE when not hidden', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      await expect(service.unhideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCodes.DUPLICATE,
      })
      expect(mockedRepository.unhideReport).not.toHaveBeenCalled()
    })

    it('409 when the atomic transition lost a race', async () => {
      mockedRepository.findById.mockResolvedValue(hiddenRow())
      mockedRepository.unhideReport.mockResolvedValue(false)
      await expect(service.unhideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('404 when missing or purged', async () => {
      mockedRepository.findById.mockResolvedValue(null)
      await expect(service.unhideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 404,
      })
      mockedRepository.findById.mockResolvedValue(hiddenRow({ purged: true }))
      await expect(service.unhideReport(7, { reasonCode: 'spam' }, ACTOR)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })
})

describe('reports-admin.service — B2 surfaces on search and detail', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.searchReports.mockResolvedValue({ rows: [], total: 0 })
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersForPanel.mockResolvedValue([])
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([])
  })

  it('search passes the hidden filter through to the repository', async () => {
    await service.searchReports({ page: 1, pageSize: 20, hidden: true })
    expect(mockedRepository.searchReports).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: true }),
      1,
      20
    )
  })

  it('list items carry the hidden mark', async () => {
    mockedRepository.searchReports.mockResolvedValue({
      rows: [searchRow({ hidden: true }), searchRow({ id: 8 })],
      total: 2,
    })
    const page = await service.searchReports({ page: 1, pageSize: 20 })
    expect(page.items[0].hidden).toBe(true)
    expect(page.items[1].hidden).toBe(false)
  })

  it('detail exposes the hidden mark with reason/note/at/by (the panel sees the reason; the owner never does)', async () => {
    mockedRepository.findById.mockResolvedValue(hiddenRow({ hiddenNote: 'copy of #5' }))
    const detail = await service.getReportPanelDetail(7)
    expect(detail).toMatchObject({
      hidden: true,
      hiddenReasonCode: 'spam',
      hiddenNote: 'copy of #5',
      hiddenAt: HIDDEN_AT.toISOString(),
      hiddenBy: ACTOR,
    })
  })

  it('detail of a visible case carries hidden=false and null reason fields', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    const detail = await service.getReportPanelDetail(7)
    expect(detail).toMatchObject({
      hidden: false,
      hiddenReasonCode: null,
      hiddenNote: null,
      hiddenAt: null,
      hiddenBy: null,
    })
  })

  it('detail keeps listing blocked media, now with the block reason (panel preserves evidence, M3)', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    mockedRepository.findAttachedMediaWithStatus.mockResolvedValue([
      {
        publicId: 'aaaaaaaa-0000-4000-8000-000000000001',
        mime: 'image/webp',
        width: 10,
        height: 10,
        status: 'available',
        blockedReasonCode: null,
        blockedNote: null,
        blockedAt: null,
      },
      {
        publicId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mime: 'image/webp',
        width: 10,
        height: 10,
        status: 'blocked',
        blockedReasonCode: 'illegal_content',
        blockedNote: null,
        blockedAt: HIDDEN_AT,
      },
    ])

    const detail = await service.getReportPanelDetail(7)

    expect(detail.media).toEqual([
      {
        publicId: 'aaaaaaaa-0000-4000-8000-000000000001',
        mime: 'image/webp',
        width: 10,
        height: 10,
        status: 'available',
        blockedReasonCode: null,
        blockedNote: null,
        blockedAt: null,
      },
      {
        publicId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mime: 'image/webp',
        width: 10,
        height: 10,
        status: 'blocked',
        blockedReasonCode: 'illegal_content',
        blockedNote: null,
        blockedAt: HIDDEN_AT.toISOString(),
      },
    ])
  })
})
