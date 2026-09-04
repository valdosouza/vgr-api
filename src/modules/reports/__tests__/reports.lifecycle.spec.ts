import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports.service'
import { ReportRow } from '@modules/reports/reports.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { validateReportDetailFields } from '@shared/risk/category-form'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/risk/category-form')
jest.mock('@shared/risk/risk-tier')
jest.mock('@shared/legal/legal-gate')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>
const mockedValidate = validateReportDetailFields as jest.MockedFunction<
  typeof validateReportDetailFields
>

const KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const OWNER_BY_KEY = { accountId: null, clientKey: KEY }
const OWNER_BY_ACCOUNT = { accountId: 42, clientKey: null }
const STRANGER = { accountId: 99, clientKey: null }

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: KEY,
    category: 'assault',
    freeTag: null,
    subject: 'adult',
    detailFields: { where: 'praça' },
    lat: -23.556789,
    lng: -46.634567,
    anonymous: false,
    reporterAccountId: 42,
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
    createdAt: new Date('2026-08-03T14:37:42Z'),
    ...overrides,
  }
}

describe('reports lifecycle (R3 — decisions 18/19/50/131/135/141)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedValidate.mockResolvedValue([])
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersWithNames.mockResolvedValue([])
    mockedRepository.getOwnerChatSummary.mockResolvedValue({ threads: 0, unread: 0 })
    mockedRepository.getHelperChatSummary.mockResolvedValue(null)
    mockedRepository.listAttachedMedia.mockResolvedValue([])
    mockedRepository.hasOfferByAccount.mockResolvedValue(false)
    mockedRepository.findPendingUnfreeze.mockResolvedValue(null)
    mockedRepository.markResolved.mockResolvedValue(true)
    mockedRepository.freeze.mockResolvedValue(true)
  })

  describe('editReport (decision 19)', () => {
    it('the anonymous owner edits by presenting the clientKey (decision 134 pattern)', async () => {
      mockedRepository.findById.mockResolvedValue(row({ reporterAccountId: null, anonymous: true }))

      const result = await service.editReport(7, { detailFields: { where: 'rua' } }, OWNER_BY_KEY)

      expect(result.changedFields).toEqual(['detailFields'])
      expect(mockedRepository.appendTimelineEvent).toHaveBeenCalledWith(7, 'edited', {
        changedFields: ['detailFields'],
      })
    })

    it('a non-owner gets 404, never 403 — existence is information', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      await expect(
        service.editReport(7, { detailFields: {} }, STRANGER)
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('a frozen case is untouchable even for the owner (decision 141)', async () => {
      mockedRepository.findById.mockResolvedValue(row({ frozen: true }))
      await expect(
        service.editReport(7, { detailFields: {} }, OWNER_BY_ACCOUNT)
      ).rejects.toMatchObject({ statusCode: 422 })
    })

    it('a resolved case cannot be edited', async () => {
      mockedRepository.findById.mockResolvedValue(row({ status: 'resolved' }))
      await expect(
        service.editReport(7, { detailFields: {} }, OWNER_BY_ACCOUNT)
      ).rejects.toMatchObject({ statusCode: 422 })
    })

    it('freeTag only changes on a free-tag report (taxonomy immutable, 140)', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      await expect(
        service.editReport(7, { freeTag: 'outra' }, OWNER_BY_ACCOUNT)
      ).rejects.toMatchObject({ statusCode: 422 })
    })

    it('edited detail fields are re-validated against the category form (47)', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      mockedValidate.mockResolvedValue(['where is required'])
      await expect(
        service.editReport(7, { detailFields: {} }, OWNER_BY_ACCOUNT)
      ).rejects.toMatchObject({ statusCode: 422 })
      expect(mockedRepository.updateEditableFields).not.toHaveBeenCalled()
    })
  })

  describe('resolveReport (decisions 18/131)', () => {
    it('stamps the retention clock: expires_at ≈ +90 days', async () => {
      mockedRepository.findById.mockResolvedValue(row())

      await service.resolveReport(7, OWNER_BY_ACCOUNT)

      const expiresAt = mockedRepository.markResolved.mock.calls[0][1]
      const days = (expiresAt.getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(89.9)
      expect(days).toBeLessThan(90.1)
      expect(mockedRepository.appendTimelineEvent).toHaveBeenCalledWith(7, 'resolved', null)
    })

    it('cannot resolve twice — the atomic transition answers 422', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      mockedRepository.markResolved.mockResolvedValue(false)
      await expect(service.resolveReport(7, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 422,
      })
      expect(mockedRepository.appendTimelineEvent).not.toHaveBeenCalled()
    })
  })

  describe('getReportView (decisions 24/41/50/135)', () => {
    it('a stranger on an OPEN case gets the degraded public view — never the exact position', async () => {
      mockedTier.mockResolvedValue('high')
      mockedRepository.findById.mockResolvedValue(row())

      const view = await service.getReportView(7, STRANGER)

      expect(view.access).toBe('public')
      if (view.access === 'public') {
        expect(view.position).toEqual({ lat: -23.56, lng: -46.63 }) // 0.01 grid
        expect(view.createdAt).toBe('2026-08-03T14:00:00.000Z') // hour bucket
      }
      expect(mockedRepository.getTimeline).not.toHaveBeenCalled()
    })

    it('a stranger on a RESOLVED case gets the closure summary only (50)', async () => {
      mockedRepository.findById.mockResolvedValue(
        row({ status: 'resolved', resolvedAt: new Date('2026-08-03T15:00:00Z') })
      )
      const view = await service.getReportView(7, STRANGER)
      expect(view.access).toBe('summary')
      expect((view as any).position).toBeUndefined()
    })

    it('the owner sees everything, with offers masked on high tier (40/41/60)', async () => {
      mockedTier.mockResolvedValue('high')
      mockedRepository.findById.mockResolvedValue(row())
      mockedRepository.findOffersWithNames.mockResolvedValue([
        {
          id: 1,
          helpType: 'physical_presence',
          anonymous: false,
          helperAccountId: 8,
          helperDisplayName: 'Ana',
          createdAt: new Date('2026-08-03T15:00:00Z'),
          ratingScore: null,
        },
      ])

      const view = await service.getReportView(7, OWNER_BY_ACCOUNT)

      expect(view.access).toBe('owner')
      if (view.access === 'owner') {
        expect(view.position).toEqual({ lat: -23.556789, lng: -46.634567 }) // exact
        expect(view.offers).toEqual([
          {
            helpOfferId: 1,
            helpType: 'physical_presence',
            helperDisplayName: null, // high tier masks even a willing identity
            createdAt: null, // and never leaks timestamps (41)
            rating: { score: null, ratable: false }, // open case (181)
          },
        ])
      }
    })

    it('low tier shows an identified helper who CHOSE to be seen (6)', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      mockedRepository.findOffersWithNames.mockResolvedValue([
        {
          id: 1,
          helpType: 'share',
          anonymous: false,
          helperAccountId: 8,
          helperDisplayName: 'Ana',
          createdAt: new Date('2026-08-03T15:00:00Z'),
          ratingScore: null,
        },
        {
          id: 2,
          helpType: 'share',
          anonymous: true,
          helperAccountId: 9,
          helperDisplayName: 'Beto',
          createdAt: new Date('2026-08-03T15:01:00Z'),
          ratingScore: null,
        },
      ])

      const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
      if (view.access === 'owner') {
        expect(view.offers?.[0].helperDisplayName).toBe('Ana')
        // Anonymity is the helper's choice — the join knew the name, the
        // view never shows it.
        expect(view.offers?.[1].helperDisplayName).toBeNull()
      }
    })

    it('an identified helper with an offer is a participant: full view, no offers list', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      mockedRepository.hasOfferByAccount.mockResolvedValue(true)

      const view = await service.getReportView(7, STRANGER)

      expect(view.access).toBe('participant')
      if (view.access === 'participant') {
        expect(view.position).toEqual({ lat: -23.556789, lng: -46.634567 })
        expect(view.offers).toBeUndefined()
      }
    })

    it('a purged case is gone (25/131)', async () => {
      mockedRepository.findById.mockResolvedValue(row({ purged: true }))
      await expect(service.getReportView(7, OWNER_BY_ACCOUNT)).rejects.toMatchObject({
        statusCode: 404,
      })
    })
  })

  describe('freeze / unfreeze (decision 141)', () => {
    it('freeze requires the case to not be frozen already', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      await service.freezeCase(7, 'Ofício 123/2026')
      expect(mockedRepository.freeze).toHaveBeenCalledWith(7, 'Ofício 123/2026')

      mockedRepository.freeze.mockResolvedValue(false)
      await expect(service.freezeCase(7, 'Ofício 123/2026')).rejects.toMatchObject({
        statusCode: 422,
      })
    })

    it('freeze leaves NO timeline event — a freeze must not tip off the reporter', async () => {
      mockedRepository.findById.mockResolvedValue(row())
      await service.freezeCase(7, 'Ofício 123/2026')
      expect(mockedRepository.appendTimelineEvent).not.toHaveBeenCalled()
    })

    it('unfreeze demands a SECOND, distinct human (141d)', async () => {
      mockedRepository.findById.mockResolvedValue(row({ frozen: true }))
      mockedRepository.findPendingUnfreeze.mockResolvedValue({
        id: 5,
        reason: 'caso arquivado',
        requestedBy: 3,
        requestedAt: new Date(),
      })

      await expect(service.approveUnfreeze(7, 3)).rejects.toMatchObject({ statusCode: 422 })

      const result = await service.approveUnfreeze(7, 4)
      expect(result.frozen).toBe(false)
      expect(mockedRepository.approveUnfreezeRequest).toHaveBeenCalledWith(5, 4)
    })

    it('unfreezing a RESOLVED case restarts the 90-day clock (141d)', async () => {
      mockedRepository.findById.mockResolvedValue(row({ frozen: true, status: 'resolved' }))
      mockedRepository.findPendingUnfreeze.mockResolvedValue({
        id: 5,
        reason: 'r',
        requestedBy: 3,
        requestedAt: new Date(),
      })

      await service.approveUnfreeze(7, 4)

      const newExpiry = mockedRepository.unfreeze.mock.calls[0][1] as Date
      const days = (newExpiry.getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(89.9)
    })

    it('unfreezing an OPEN case leaves no expiry — the clock starts at resolution', async () => {
      mockedRepository.findById.mockResolvedValue(row({ frozen: true, status: 'open' }))
      mockedRepository.findPendingUnfreeze.mockResolvedValue({
        id: 5,
        reason: 'r',
        requestedBy: 3,
        requestedAt: new Date(),
      })
      await service.approveUnfreeze(7, 4)
      expect(mockedRepository.unfreeze).toHaveBeenCalledWith(7, null)
    })

    it('a second unfreeze request while one is pending is a 409', async () => {
      mockedRepository.findById.mockResolvedValue(row({ frozen: true }))
      mockedRepository.findPendingUnfreeze.mockResolvedValue({
        id: 5,
        reason: 'r',
        requestedBy: 3,
        requestedAt: new Date(),
      })
      await expect(service.requestUnfreeze(7, 'de novo', 4)).rejects.toMatchObject({
        statusCode: 409,
      })
    })
  })

  it('purge drains batches and respects the repository contract (25/131)', async () => {
    mockedRepository.findExpiredReports
      .mockResolvedValueOnce([1, 2, 3])
      .mockResolvedValue([])
    const result = await service.purgeExpiredReports()
    expect(result.purged).toBe(3)
    expect(mockedRepository.purgeReport).toHaveBeenCalledTimes(3)
  })
})

describe('hidden report on the APP plane (B2 — decisions 162/167)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersWithNames.mockResolvedValue([])
    mockedRepository.getOwnerChatSummary.mockResolvedValue({ threads: 0, unread: 0 })
    mockedRepository.getHelperChatSummary.mockResolvedValue(null)
    mockedRepository.listAttachedMedia.mockResolvedValue([])
    mockedRepository.hasOfferByAccount.mockResolvedValue(false)
  })

  it('a stranger gets 404 on a hidden OPEN case — gone from the public detail', async () => {
    mockedRepository.findById.mockResolvedValue(row({ hidden: true, hiddenReasonCode: 'spam' }))
    await expect(service.getReportView(7, STRANGER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('a stranger gets 404 on a hidden RESOLVED case — no closure summary either', async () => {
    mockedRepository.findById.mockResolvedValue(
      row({ hidden: true, hiddenReasonCode: 'spam', status: 'resolved', resolvedAt: new Date() })
    )
    await expect(service.getReportView(7, STRANGER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('the OWNER keeps seeing it, with hidden=true and NO reason (167)', async () => {
    mockedRepository.findById.mockResolvedValue(
      row({ hidden: true, hiddenReasonCode: 'spam', hiddenNote: 'copy of #5', hiddenBy: 3 })
    )

    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)

    expect(view.access).toBe('owner')
    expect((view as any).hidden).toBe(true)
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('spam')
    expect(serialized).not.toContain('copy of #5')
    expect(serialized).not.toContain('hiddenReason')
    expect(serialized).not.toContain('hiddenBy')
    expect(serialized).not.toContain('hiddenAt')
  })

  it('a PARTICIPANT sees the same mark', async () => {
    mockedRepository.findById.mockResolvedValue(row({ hidden: true, hiddenReasonCode: 'abuse' }))
    mockedRepository.hasOfferByAccount.mockResolvedValue(true)

    const view = await service.getReportView(7, STRANGER)

    expect(view.access).toBe('participant')
    expect((view as any).hidden).toBe(true)
    expect(JSON.stringify(view)).not.toContain('abuse')
  })

  it('a visible case answers hidden=false to the owner', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    const view = await service.getReportView(7, OWNER_BY_KEY)
    expect((view as any).hidden).toBe(false)
  })

  it('no timeline event is ever written by moderation (167) — the timeline stays as it was', async () => {
    mockedRepository.findById.mockResolvedValue(row({ hidden: true }))
    mockedRepository.getTimeline.mockResolvedValue([
      { eventType: 'created', payload: null, createdAt: new Date('2026-08-03T14:37:42Z') },
    ])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    if (view.access !== 'owner') throw new Error('expected owner view')
    expect(view.timeline.map((e) => e.eventType)).toEqual(['created'])
  })
})

/** C1 (decisions 168-177): the detail view carries the chat entry point
 *  so C2 can render it — counts only, never a message, never a token. */
describe('getReportView — chat entry point (C1, decision 172)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersWithNames.mockResolvedValue([])
    mockedRepository.listAttachedMedia.mockResolvedValue([])
    mockedRepository.hasOfferByAccount.mockResolvedValue(false)
    mockedRepository.getOwnerChatSummary.mockResolvedValue({ threads: 2, unread: 3 })
    mockedRepository.getHelperChatSummary.mockResolvedValue({ threadId: 5, unread: 1 })
  })

  it('the owner gets { threads, unread }', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    const view = await service.getReportView(7, OWNER_BY_KEY)
    expect(view.access).toBe('owner')
    expect((view as any).chat).toEqual({ threads: 2, unread: 3 })
    expect(mockedRepository.getOwnerChatSummary).toHaveBeenCalledWith(7)
    expect(mockedRepository.getHelperChatSummary).not.toHaveBeenCalled()
  })

  it('a helper participant gets { threadId, unread } — null threadId before the first message', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    mockedRepository.hasOfferByAccount.mockResolvedValue(true)
    let view = await service.getReportView(7, STRANGER)
    expect(view.access).toBe('participant')
    expect((view as any).chat).toEqual({ threadId: 5, unread: 1 })
    expect(mockedRepository.getHelperChatSummary).toHaveBeenCalledWith(7, 99)

    mockedRepository.getHelperChatSummary.mockResolvedValue(null)
    view = await service.getReportView(7, STRANGER)
    expect((view as any).chat).toEqual({ threadId: null, unread: 0 })
  })

  it('public and summary views carry NO chat field', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    const open = await service.getReportView(7, STRANGER)
    expect(open.access).toBe('public')
    expect((open as any).chat).toBeUndefined()

    mockedRepository.findById.mockResolvedValue(
      row({ status: 'resolved', resolvedAt: new Date('2026-08-03T15:00:00Z') })
    )
    const summary = await service.getReportView(7, STRANGER)
    expect(summary.access).toBe('summary')
    expect((summary as any).chat).toBeUndefined()
    expect(mockedRepository.getOwnerChatSummary).not.toHaveBeenCalled()
    expect(mockedRepository.getHelperChatSummary).not.toHaveBeenCalled()
  })
})

/** RT1 (decisions 48, 180-185, 187): the OWNER view carries, per offer,
 *  the rating facet the app needs to render "rate" / "rated" — and no
 *  other view ever carries rating data (185). */
describe('getReportView — offers[].rating (RT1, decisions 48/180/181/183/185)', () => {
  const helperOffer = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    helpType: 'share',
    anonymous: true,
    helperAccountId: 8,
    helperDisplayName: 'Ana',
    createdAt: new Date('2026-08-03T15:00:00Z'),
    ratingScore: null,
    ...overrides,
  })
  const resolved = (overrides: Partial<ReportRow> = {}) =>
    row({ status: 'resolved', resolvedAt: new Date('2026-08-03T16:00:00Z'), ...overrides })

  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.listAttachedMedia.mockResolvedValue([])
    mockedRepository.hasOfferByAccount.mockResolvedValue(false)
    mockedRepository.getOwnerChatSummary.mockResolvedValue({ threads: 0, unread: 0 })
    mockedRepository.getHelperChatSummary.mockResolvedValue(null)
  })

  it('resolved case, helper with an account, not rated yet -> { score: null, ratable: true }', async () => {
    mockedRepository.findById.mockResolvedValue(resolved())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer()])
    const view = await service.getReportView(7, OWNER_BY_KEY)
    expect(view.access).toBe('owner')
    expect((view as any).offers[0].rating).toEqual({ score: null, ratable: true })
  })

  it('already rated -> the score comes back and ratable is false (183: immutable)', async () => {
    mockedRepository.findById.mockResolvedValue(resolved())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer({ ratingScore: 4 })])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    expect((view as any).offers[0].rating).toEqual({ score: 4, ratable: false })
  })

  it('an OPEN case is never ratable (181)', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer()])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    expect((view as any).offers[0].rating).toEqual({ score: null, ratable: false })
  })

  it('a HIDDEN resolved case is not ratable while hidden (162/187) — an existing score still shows', async () => {
    mockedRepository.findById.mockResolvedValue(resolved({ hidden: true }))
    mockedRepository.findOffersWithNames.mockResolvedValue([
      helperOffer(),
      helperOffer({ id: 2, ratingScore: 5 }),
    ])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    expect((view as any).offers[0].rating).toEqual({ score: null, ratable: false })
    expect((view as any).offers[1].rating).toEqual({ score: 5, ratable: false })
  })

  it('a helper WITHOUT an account is never ratable (180)', async () => {
    mockedRepository.findById.mockResolvedValue(resolved())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer({ helperAccountId: null })])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    expect((view as any).offers[0].rating).toEqual({ score: null, ratable: false })
  })

  it('the offer entry never leaks the raw join columns (helperAccountId / ratingScore)', async () => {
    mockedRepository.findById.mockResolvedValue(resolved())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer({ ratingScore: 3 })])
    const view = await service.getReportView(7, OWNER_BY_ACCOUNT)
    expect(Object.keys((view as any).offers[0]).sort()).toEqual(
      ['createdAt', 'helpType', 'helpOfferId', 'helperDisplayName', 'rating'].sort()
    )
    expect(JSON.stringify(view)).not.toContain('helperAccountId')
    expect(JSON.stringify(view)).not.toContain('ratingScore')
  })

  it('a PARTICIPANT (helper) view carries no rating data at all (184/185)', async () => {
    mockedRepository.findById.mockResolvedValue(resolved())
    mockedRepository.hasOfferByAccount.mockResolvedValue(true)
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer({ ratingScore: 1 })])
    const view = await service.getReportView(7, STRANGER)
    expect(view.access).toBe('participant')
    expect((view as any).offers).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('rating')
    expect(mockedRepository.findOffersWithNames).not.toHaveBeenCalled()
  })

  it('public and summary views carry no rating data either (185)', async () => {
    mockedRepository.findById.mockResolvedValue(row())
    mockedRepository.findOffersWithNames.mockResolvedValue([helperOffer({ ratingScore: 1 })])
    const open = await service.getReportView(7, STRANGER)
    expect(open.access).toBe('public')
    expect(JSON.stringify(open)).not.toContain('rating')

    mockedRepository.findById.mockResolvedValue(resolved())
    const summary = await service.getReportView(7, STRANGER)
    expect(summary.access).toBe('summary')
    expect(JSON.stringify(summary)).not.toContain('rating')
  })
})
