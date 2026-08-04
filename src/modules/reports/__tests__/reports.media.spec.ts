import * as repository from '@modules/reports/reports.repository'
import * as service from '@modules/reports/reports.service'
import { ReportRow } from '@modules/reports/reports.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { assertCapability } from '@shared/legal/legal-gate'
import { getRiskTier } from '@shared/risk/risk-tier'
import { openMediaObject } from '@shared/storage/media-object'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/reports/reports.repository')
jest.mock('@shared/audit/accountability')
jest.mock('@shared/risk/category-form')
jest.mock('@shared/risk/risk-tier')
jest.mock('@shared/legal/legal-gate')
jest.mock('@shared/storage/media-object')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedTier = getRiskTier as jest.MockedFunction<typeof getRiskTier>
const mockedGate = assertCapability as jest.MockedFunction<typeof assertCapability>
const mockedAccountability = appendAccountabilityLogEntry as jest.MockedFunction<
  typeof appendAccountabilityLogEntry
>
const mockedOpenObject = openMediaObject as jest.MockedFunction<typeof openMediaObject>

const KEY = '3f9d1c2e-0000-4000-8000-000000000001'
const MEDIA_ID = '9b2b6c1a-0000-4000-8000-000000000002'
const OWNER_BY_KEY = { accountId: null, clientKey: KEY }
const OWNER_BY_ACCOUNT = { accountId: 42, clientKey: null }
const STRANGER = { accountId: 99, clientKey: null }
const IP = '10.0.0.1'

function report(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 7,
    clientKey: KEY,
    category: 'assault',
    freeTag: null,
    subject: 'adult',
    detailFields: null,
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
    createdAt: new Date('2026-08-03T14:37:42Z'),
    ...overrides,
  }
}

function media(
  overrides: Partial<repository.AttachableMediaRow> = {}
): repository.AttachableMediaRow {
  return {
    id: 3,
    publicId: MEDIA_ID,
    class: 'evidence',
    uploaderAccountId: null,
    status: 'pending',
    mime: 'image/webp',
    width: 800,
    height: 600,
    storagePrefix: 'ab12cd34-0000-4000-8000-000000000003',
    dekWrapped: 'v1.k1.iv.tag.wrapped',
    ...overrides,
  }
}

describe('report media — M2 (decisions 128/129/134/136/138)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedTier.mockResolvedValue('low')
    mockedRepository.findById.mockResolvedValue(report())
    mockedRepository.findMediaByPublicId.mockResolvedValue(media())
    mockedRepository.countAttachedMedia.mockResolvedValue(0)
    mockedRepository.attachMedia.mockResolvedValue('attached')
    mockedRepository.isMediaLinked.mockResolvedValue(false)
    mockedRepository.hasOfferByAccount.mockResolvedValue(false)
    mockedRepository.listAttachedMedia.mockResolvedValue([])
    mockedRepository.getTimeline.mockResolvedValue([])
    mockedRepository.findOffersWithNames.mockResolvedValue([])
    mockedRepository.findPendingUnfreeze.mockResolvedValue(null)
    mockedRepository.markResolved.mockResolvedValue(true)
    mockedRepository.freeze.mockResolvedValue(true)
    mockedOpenObject.mockResolvedValue(Buffer.from('plain-image'))
    delete process.env.MEDIA_MAX_PER_REPORT
  })

  describe('attachMedia (decision 134)', () => {
    it('anonymous owner attaches anonymous media by bearer publicId — and leaves the forensic trail', async () => {
      const result = await service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)

      expect(result).toEqual({ reportId: 7, mediaPublicId: MEDIA_ID, replayed: false })
      expect(mockedGate).toHaveBeenCalledWith('report.media', { userRef: undefined, ip: IP })
      expect(mockedRepository.attachMedia).toHaveBeenCalledWith(7, { id: 3, publicId: MEDIA_ID })
      expect(mockedAccountability).toHaveBeenCalledWith('report.media.attach', IP, {
        reportId: 7,
        mediaPublicId: MEDIA_ID,
      })
    })

    it('an authenticated attach never writes the anonymous trail', async () => {
      await service.attachMedia(7, MEDIA_ID, OWNER_BY_ACCOUNT, IP)
      expect(mockedAccountability).not.toHaveBeenCalled()
    })

    it('the Legal Gate blocks the attach before any write (decision 138)', async () => {
      mockedGate.mockRejectedValue(new HttpError(451, 'blocked', undefined, 'LEGAL_BLOCKED'))
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 451,
      })
      expect(mockedRepository.attachMedia).not.toHaveBeenCalled()
    })

    it('a non-owner of the report gets 404 — existence is information', async () => {
      await expect(service.attachMedia(7, MEDIA_ID, STRANGER, IP)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('resolved and frozen reports refuse new evidence (decisions 18/141)', async () => {
      mockedRepository.findById.mockResolvedValue(report({ status: 'resolved' }))
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_ACCOUNT, IP)).rejects.toMatchObject({
        statusCode: 422,
      })

      mockedRepository.findById.mockResolvedValue(report({ frozen: true }))
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_ACCOUNT, IP)).rejects.toMatchObject({
        statusCode: 422,
      })
    })

    it("account-owned media only attaches through the same account (134) — others see 404", async () => {
      mockedRepository.findMediaByPublicId.mockResolvedValue(media({ uploaderAccountId: 42 }))

      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 404,
      })
      await expect(
        service.attachMedia(7, MEDIA_ID, OWNER_BY_ACCOUNT, IP)
      ).resolves.toMatchObject({ replayed: false })
    })

    it('shredded media cannot be attached (the orphan job won the race, 136)', async () => {
      mockedRepository.findMediaByPublicId.mockResolvedValue(
        media({ status: 'deleted', dekWrapped: null })
      )
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('replay answers 200-shape (replayed) when the media is already on THIS report (137 contract)', async () => {
      mockedRepository.findMediaByPublicId.mockResolvedValue(media({ status: 'available' }))
      mockedRepository.isMediaLinked.mockResolvedValue(true)

      const result = await service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)
      expect(result.replayed).toBe(true)
      expect(mockedRepository.attachMedia).not.toHaveBeenCalled()
    })

    it('media consumed by ANOTHER report answers 409 — one attach only (134)', async () => {
      mockedRepository.findMediaByPublicId.mockResolvedValue(media({ status: 'available' }))
      mockedRepository.isMediaLinked.mockResolvedValue(false)

      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('a raced claim ("not_pending" from the transaction) answers 409', async () => {
      mockedRepository.attachMedia.mockResolvedValue('not_pending')
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 409,
      })
    })

    it('a raced duplicate link is a replay, not an error', async () => {
      mockedRepository.attachMedia.mockResolvedValue('already_linked')
      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).resolves.toMatchObject({
        replayed: true,
      })
    })

    it('enforces MEDIA_MAX_PER_REPORT from config (decision 129)', async () => {
      process.env.MEDIA_MAX_PER_REPORT = '2'
      mockedRepository.countAttachedMedia.mockResolvedValue(2)

      await expect(service.attachMedia(7, MEDIA_ID, OWNER_BY_KEY, IP)).rejects.toMatchObject({
        statusCode: 422,
      })
      expect(mockedRepository.attachMedia).not.toHaveBeenCalled()
    })
  })

  describe('getReportMediaVariant (decisions 128/135 — report-scoped serving)', () => {
    it('the owner streams the sharp variant — including anonymous-owned media', async () => {
      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'available' }))

      const { data, mime } = await service.getReportMediaVariant(7, MEDIA_ID, 'normalized', OWNER_BY_KEY)
      expect(mime).toBe('image/webp')
      expect(data.toString()).toBe('plain-image')
    })

    it('a media outside this report answers 404 (scope is the report)', async () => {
      mockedRepository.findAttachedMedia.mockResolvedValue(null)
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', OWNER_BY_KEY)
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('public viewer of a HIGH-tier open case gets only the blur (decision 128)', async () => {
      mockedTier.mockResolvedValue('high')
      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'available' }))

      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', STRANGER)
      ).rejects.toMatchObject({ statusCode: 404 })
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'blur', STRANGER)
      ).resolves.toMatchObject({ mime: 'image/webp' })
    })

    it('public viewer of a low-tier open case may see the sharp derivative', async () => {
      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'available' }))
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', STRANGER)
      ).resolves.toBeDefined()
    })

    it('a resolved case serves media only to participants (decision 50)', async () => {
      mockedRepository.findById.mockResolvedValue(
        report({ status: 'resolved', resolvedAt: new Date() })
      )
      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'available' }))

      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', STRANGER)
      ).rejects.toMatchObject({ statusCode: 404 })

      mockedRepository.hasOfferByAccount.mockResolvedValue(true)
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', STRANGER)
      ).resolves.toBeDefined()
    })

    it('blocked media disappears from the app plane; the original never leaves the panel (130)', async () => {
      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'blocked' }))
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'normalized', OWNER_BY_KEY)
      ).rejects.toMatchObject({ statusCode: 404 })

      mockedRepository.findAttachedMedia.mockResolvedValue(media({ status: 'available' }))
      await expect(
        service.getReportMediaVariant(7, MEDIA_ID, 'original', OWNER_BY_KEY)
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('lifecycle propagation (decisions 131/141b/141d)', () => {
    it('resolveReport stamps the SAME retention clock on the attached evidence', async () => {
      await service.resolveReport(7, OWNER_BY_ACCOUNT)

      const reportClock = mockedRepository.markResolved.mock.calls[0][1]
      expect(mockedRepository.stampAttachedMediaExpiry).toHaveBeenCalledWith(7, reportClock)
    })

    it('freezeCase freezes the attached evidence in the same act (141b)', async () => {
      await service.freezeCase(7, 'writ 123/2026')
      expect(mockedRepository.setAttachedMediaFrozen).toHaveBeenCalledWith(7, true)
    })

    it('approveUnfreeze thaws the evidence on the RESTARTED clock (141d)', async () => {
      mockedRepository.findById.mockResolvedValue(
        report({ frozen: true, status: 'resolved', resolvedAt: new Date() })
      )
      mockedRepository.findPendingUnfreeze.mockResolvedValue({
        id: 1,
        reason: 'closed',
        requestedBy: 10,
        requestedAt: new Date(),
      })

      await service.approveUnfreeze(7, 11)

      const [, unfrozen, mediaClock] = mockedRepository.setAttachedMediaFrozen.mock.calls[0]
      const reportClock = mockedRepository.unfreeze.mock.calls[0][1]
      expect(unfrozen).toBe(false)
      expect(mediaClock).toEqual(reportClock)
    })

    it('the owner view lists attached media; the public view carries publicIds only', async () => {
      mockedRepository.listAttachedMedia.mockResolvedValue([media({ status: 'available' })])

      const ownerView = await service.getReportView(7, OWNER_BY_ACCOUNT)
      expect(ownerView).toMatchObject({
        access: 'owner',
        media: [{ publicId: MEDIA_ID, mime: 'image/webp', width: 800, height: 600 }],
      })

      const publicView = await service.getReportView(7, STRANGER)
      expect(publicView).toMatchObject({ access: 'public', media: [{ publicId: MEDIA_ID }] })
      expect((publicView as any).media[0].mime).toBeUndefined()
    })
  })
})
