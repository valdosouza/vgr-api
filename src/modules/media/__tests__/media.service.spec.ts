import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import sharp from 'sharp'
import * as repository from '@modules/media/media.repository'
import * as service from '@modules/media/media.service'
import { MediaRow } from '@modules/media/media.interface'
import { sniffMime } from '@modules/media/media-pipeline'
import { openBlob, unwrapDek } from '@shared/crypto/media-cipher'
import { blobStore, resetBlobStoreForTests } from '@shared/storage/blob-store'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/media/media.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 128, height: 96, channels: 3, background: '#a52' } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: 'gps-stand-in' } } })
    .toBuffer()
}

function ingestInput(data: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    data,
    class: 'evidence' as const,
    uploaderAccountId: 42,
    keepOriginal: false,
    exifWarningVersion: null,
    ...overrides,
  }
}

/** Rebuilds the row that findByPublicId would return from what ingest
 *  actually inserted — the storage prefix and wrapped DEK are real. */
function insertedRow(overrides: Partial<MediaRow> = {}): MediaRow {
  const args = mockedRepository.insertMedia.mock.calls[0][0]
  return {
    id: 1,
    publicId: args.publicId,
    class: args.class as MediaRow['class'],
    uploaderAccountId: args.uploaderAccountId,
    status: 'available',
    mimeOriginal: args.mimeOriginal,
    mime: args.mime,
    bytesOriginal: args.bytesOriginal,
    bytes: args.bytes,
    width: args.width,
    height: args.height,
    sha256Original: args.sha256Original,
    sha256: args.sha256,
    storagePrefix: args.storagePrefix,
    keepOriginal: args.keepOriginal,
    exifWarningVersion: args.exifWarningVersion,
    dekWrapped: args.dekWrapped,
    expiresAt: null,
    frozen: false,
    ...overrides,
  }
}

describe('media.service (decisions 126-131)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vgr-media-'))
    process.env.MEDIA_KEK = randomBytes(32).toString('base64')
    process.env.MEDIA_FS_ROOT = root
    delete process.env.BLOB_STORE
    delete process.env.AVATAR_ENABLED
    delete process.env.MEDIA_MAX_BYTES
    resetBlobStoreForTests()
    jest.resetAllMocks()
    mockedRepository.insertMedia.mockResolvedValue(1)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('ingest', () => {
    it('re-encodes, encrypts and records — and what hits storage is ciphertext', async () => {
      const result = await service.ingest(ingestInput(await photo()))

      expect(result.mime).toBe('image/webp')
      const args = mockedRepository.insertMedia.mock.calls[0][0]
      // Evidence is born 'pending' — the attach consumes it (M2, decision 134).
      expect(args.status).toBe('pending')
      expect(args.mimeOriginal).toBe('image/jpeg')
      expect(args.sha256Original).toHaveLength(64)

      const key = `${args.storagePrefix.slice(0, 2)}/${args.storagePrefix}/normalized`
      const sealed = await blobStore().get(key)
      expect(sealed).not.toBeNull()
      // Storage holds no recognizable image (plan §3: a leaked bucket is noise)...
      expect(sniffMime(sealed!)).toBeNull()
      // ...but the DEK recorded in tb_media opens it, and the plaintext is
      // the EXIF-free webp.
      const plain = openBlob(unwrapDek(args.dekWrapped), sealed!)
      expect(sniffMime(plain)).toBe('image/webp')
      expect((await sharp(plain).metadata()).exif).toBeUndefined()
    })

    it('writes thumb and blur derivatives, and no original by default (decision 130)', async () => {
      await service.ingest(ingestInput(await photo()))
      const { storagePrefix } = mockedRepository.insertMedia.mock.calls[0][0]
      const prefix = `${storagePrefix.slice(0, 2)}/${storagePrefix}`
      expect(await blobStore().get(`${prefix}/thumb`)).not.toBeNull()
      expect(await blobStore().get(`${prefix}/blur`)).not.toBeNull()
      expect(await blobStore().get(`${prefix}/original`)).toBeNull()
    })

    it('keepOriginal stores the EXIF original encrypted, with the warning version (decision 130)', async () => {
      const source = await photo()
      await service.ingest(
        ingestInput(source, { keepOriginal: true, exifWarningVersion: 'v1' })
      )
      const args = mockedRepository.insertMedia.mock.calls[0][0]
      expect(args.keepOriginal).toBe(true)
      expect(args.exifWarningVersion).toBe('v1')

      const sealed = await blobStore().get(
        `${args.storagePrefix.slice(0, 2)}/${args.storagePrefix}/original`
      )
      // Byte-exact original (chain of custody), EXIF included — but sealed.
      expect(openBlob(unwrapDek(args.dekWrapped), sealed!).equals(source)).toBe(true)
    })

    it('keepOriginal without the warning text version is refused (decision 86 pattern)', async () => {
      await expect(
        service.ingest(ingestInput(await photo(), { keepOriginal: true }))
      ).rejects.toMatchObject({ statusCode: 422 })
      expect(mockedRepository.insertMedia).not.toHaveBeenCalled()
    })

    it('rejects the avatar class while decision 127 keeps it off', async () => {
      await expect(
        service.ingest(ingestInput(await photo(), { class: 'avatar' }))
      ).rejects.toMatchObject({ statusCode: 422, code: 'NOT_AVAILABLE' })

      process.env.AVATAR_ENABLED = 'true'
      await expect(
        service.ingest(ingestInput(await photo(), { class: 'avatar' }))
      ).resolves.toBeDefined()
    })

    it('rejects non-image bytes whatever the claimed type', async () => {
      await expect(
        service.ingest(ingestInput(Buffer.from('%PDF-1.4 not an image at all')))
      ).rejects.toMatchObject({ statusCode: 422 })
    })

    it('enforces the size limit from config (decision 129)', async () => {
      process.env.MEDIA_MAX_BYTES = '100'
      await expect(service.ingest(ingestInput(await photo()))).rejects.toMatchObject({
        statusCode: 422,
      })
    })
  })

  describe('openVariant — owner-only, 404 for everything else', () => {
    async function ingested(): Promise<MediaRow> {
      await service.ingest(ingestInput(await photo()))
      return insertedRow()
    }

    it('streams an owned variant decrypted', async () => {
      const row = await ingested()
      mockedRepository.findByPublicId.mockResolvedValue(row)
      const { data, mime } = await service.openVariant(row.publicId, 'normalized', 42)
      expect(mime).toBe('image/webp')
      expect(sniffMime(data)).toBe('image/webp')
    })

    it('404 for another account, even though the media exists', async () => {
      const row = await ingested()
      mockedRepository.findByPublicId.mockResolvedValue(row)
      await expect(service.openVariant(row.publicId, 'normalized', 99)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('404 for anonymous-owned media on the app route', async () => {
      const row = await ingested()
      mockedRepository.findByPublicId.mockResolvedValue({ ...row, uploaderAccountId: null })
      await expect(service.openVariant(row.publicId, 'normalized', 42)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('404 for the original — panel-only (decision 130)', async () => {
      const row = await ingested()
      mockedRepository.findByPublicId.mockResolvedValue(row)
      await expect(service.openVariant(row.publicId, 'original', 42)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('404 when blocked or crypto-shredded (decision 131)', async () => {
      const row = await ingested()
      mockedRepository.findByPublicId.mockResolvedValue({ ...row, status: 'blocked' })
      await expect(service.openVariant(row.publicId, 'normalized', 42)).rejects.toMatchObject({
        statusCode: 404,
      })
      mockedRepository.findByPublicId.mockResolvedValue({ ...row, dekWrapped: null })
      await expect(service.openVariant(row.publicId, 'normalized', 42)).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    it('propagates a 404 as HttpError with the catalog code', async () => {
      mockedRepository.findByPublicId.mockResolvedValue(null)
      const err = await service.openVariant('nope', 'normalized', 1).catch((e) => e)
      expect(err).toBeInstanceOf(HttpError)
      expect(err.code).toBe('NOT_FOUND')
    })
  })
})
