import * as repository from '@modules/media/media.repository'
import * as service from '@modules/media/media.service'
import { MediaRow } from '@modules/media/media.interface'
import { ErrorCodes } from '@shared/errors/error-codes'

jest.mock('@modules/media/media.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

const PUBLIC_ID = '9b2b6c1a-0000-4000-8000-000000000002'
const ACTOR = 3
const BLOCKED_AT = new Date('2026-09-02T10:00:00Z')

function row(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: 1,
    publicId: PUBLIC_ID,
    class: 'evidence',
    uploaderAccountId: null,
    status: 'available',
    mimeOriginal: 'image/jpeg',
    mime: 'image/webp',
    bytesOriginal: 100,
    bytes: 80,
    width: 10,
    height: 10,
    sha256Original: 'a',
    sha256: 'b',
    storagePrefix: 'ab12cd34-0000-4000-8000-000000000003',
    keepOriginal: false,
    exifWarningVersion: null,
    dekWrapped: 'v1.k1.iv.tag.wrapped',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    frozen: false,
    blockedReasonCode: null,
    blockedNote: null,
    blockedAt: null,
    blockedBy: null,
    ...overrides,
  }
}

function blockedRow(overrides: Partial<MediaRow> = {}): MediaRow {
  return row({
    status: 'blocked',
    blockedReasonCode: 'illegal_content',
    blockedNote: null,
    blockedAt: BLOCKED_AT,
    blockedBy: ACTOR,
    ...overrides,
  })
}

/** A moderation hold preserves evidence (M3): it must never shred. */
function expectEvidencePreserved(): void {
  expect(mockedRepository.shred).not.toHaveBeenCalled()
}

describe('media.service — block / unblock for the panel (B2 — decisions 162/163)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.blockMedia.mockResolvedValue(true)
    mockedRepository.unblockMedia.mockResolvedValue(true)
  })

  describe('blockMedia', () => {
    it('available -> blocked with the catalog reason and the acting user; answers the moderation state', async () => {
      mockedRepository.findByPublicId.mockResolvedValueOnce(row()).mockResolvedValueOnce(blockedRow())

      const state = await service.blockMedia(PUBLIC_ID, { reasonCode: 'illegal_content' }, ACTOR)

      expect(mockedRepository.blockMedia).toHaveBeenCalledWith(1, 'illegal_content', null, ACTOR)
      expect(state).toEqual({
        publicId: PUBLIC_ID,
        status: 'blocked',
        blockedReasonCode: 'illegal_content',
        blockedNote: null,
        blockedAt: BLOCKED_AT.toISOString(),
      })
      expectEvidencePreserved()
    })

    it('stores the note when given', async () => {
      mockedRepository.findByPublicId
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(blockedRow({ blockedReasonCode: 'other', blockedNote: 'face of a minor' }))

      const state = await service.blockMedia(
        PUBLIC_ID,
        { reasonCode: 'other', note: 'face of a minor' },
        ACTOR
      )

      expect(mockedRepository.blockMedia).toHaveBeenCalledWith(1, 'other', 'face of a minor', ACTOR)
      expect(state.blockedNote).toBe('face of a minor')
    })

    it('404 when missing', async () => {
      mockedRepository.findByPublicId.mockResolvedValue(null)
      await expect(
        service.blockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
      ).rejects.toMatchObject({ statusCode: 404, code: ErrorCodes.NOT_FOUND })
      expect(mockedRepository.blockMedia).not.toHaveBeenCalled()
    })

    it.each(['pending', 'blocked', 'deleted'] as const)(
      '404 for any status other than available (%s) — nothing written',
      async (status) => {
        mockedRepository.findByPublicId.mockResolvedValue(row({ status }))
        await expect(
          service.blockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
        ).rejects.toMatchObject({ statusCode: 404 })
        expect(mockedRepository.blockMedia).not.toHaveBeenCalled()
      }
    )

    it('404 when the atomic transition lost a race (0 rows)', async () => {
      mockedRepository.findByPublicId.mockResolvedValue(row())
      mockedRepository.blockMedia.mockResolvedValue(false)
      await expect(
        service.blockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
      ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('frozen evidence can still be blocked — hold and moderation are independent', async () => {
      mockedRepository.findByPublicId
        .mockResolvedValueOnce(row({ frozen: true }))
        .mockResolvedValueOnce(blockedRow({ frozen: true }))
      const state = await service.blockMedia(PUBLIC_ID, { reasonCode: 'abuse' }, ACTOR)
      expect(state.status).toBe('blocked')
    })
  })

  describe('unblockMedia', () => {
    it('blocked -> available under the SAME single-human rule (162), clearing the four columns', async () => {
      mockedRepository.findByPublicId.mockResolvedValueOnce(blockedRow()).mockResolvedValueOnce(row())

      const state = await service.unblockMedia(
        PUBLIC_ID,
        { reasonCode: 'other', note: 'appeal upheld' },
        ACTOR
      )

      expect(mockedRepository.unblockMedia).toHaveBeenCalledWith(1)
      expect(state).toEqual({
        publicId: PUBLIC_ID,
        status: 'available',
        blockedReasonCode: null,
        blockedNote: null,
        blockedAt: null,
      })
      expectEvidencePreserved()
    })

    it.each(['pending', 'available', 'deleted'] as const)(
      '404 for any status other than blocked (%s)',
      async (status) => {
        mockedRepository.findByPublicId.mockResolvedValue(row({ status }))
        await expect(
          service.unblockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
        ).rejects.toMatchObject({ statusCode: 404 })
        expect(mockedRepository.unblockMedia).not.toHaveBeenCalled()
      }
    )

    it('404 when missing or when the atomic transition lost a race', async () => {
      mockedRepository.findByPublicId.mockResolvedValue(null)
      await expect(
        service.unblockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
      ).rejects.toMatchObject({ statusCode: 404 })

      mockedRepository.findByPublicId.mockResolvedValue(blockedRow())
      mockedRepository.unblockMedia.mockResolvedValue(false)
      await expect(
        service.unblockMedia(PUBLIC_ID, { reasonCode: 'spam' }, ACTOR)
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  // "Blocked media stays readable on the panel" is proven end-to-end, with
  // a real ingested object, in media-admin.routes.spec (M3) — not repeated.
})
