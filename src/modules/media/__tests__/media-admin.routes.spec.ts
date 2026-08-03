import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import request from 'supertest'
import sharp from 'sharp'
import app from '../../../app'
import * as repository from '@modules/media/media.repository'
import * as service from '@modules/media/media.service'
import { MediaRow } from '@modules/media/media.interface'
import * as privilegeStore from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import * as adminAudit from '@shared/audit/admin-audit'
import { signSession } from '@modules/auth/admin-login.service'
import { resetBlobStoreForTests } from '@shared/storage/blob-store'

jest.mock('@modules/media/media.repository')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')
jest.mock('@shared/audit/admin-audit')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedPrivileges = privilegeStore as jest.Mocked<typeof privilegeStore>
const mockedSessions = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAudit = adminAudit as jest.Mocked<typeof adminAudit>

describe('/api/media panel routes (M3 — decisions 116/130)', () => {
  let root: string
  let token: string
  let row: MediaRow

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'vgr-media-admin-'))
    process.env.JWT_SECRET = 'test-secret'
    process.env.MEDIA_KEK = randomBytes(32).toString('base64')
    process.env.MEDIA_FS_ROOT = root
    delete process.env.BLOB_STORE
    resetBlobStoreForTests()
    jest.resetAllMocks()
    mockedSessions.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    token = signSession(3, 1)

    // Real ingest (fs store + real crypto), captured into the row the
    // repository mock serves back — EXIF original kept.
    mockedRepository.insertMedia.mockResolvedValue(1)
    const jpeg = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#06c' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { ImageDescription: 'gps-stand-in' } } })
      .toBuffer()
    await service.ingest({
      data: jpeg,
      class: 'evidence',
      uploaderAccountId: null, // anonymous — the panel still sees it
      keepOriginal: true,
      exifWarningVersion: 'v1',
    })
    const args = mockedRepository.insertMedia.mock.calls[0][0]
    row = {
      id: 1,
      publicId: args.publicId,
      class: 'evidence',
      uploaderAccountId: null,
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
      keepOriginal: true,
      exifWarningVersion: 'v1',
      dekWrapped: args.dekWrapped,
      expiresAt: null,
      frozen: false,
    }
    mockedRepository.findByPublicId.mockResolvedValue(row)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function grant(evidence: boolean, original: boolean): void {
    mockedPrivileges.userHasPrivilege.mockImplementation(async (_userId, interfaceKey) =>
      interfaceKey === 'media_evidence' ? evidence : original
    )
  }

  it('serves a derivative with media_evidence and leaves an audit row', async () => {
    grant(true, false)
    const res = await request(app)
      .get(`/api/media/${row.publicId}/thumb`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/webp')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(mockedAudit.auditFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'read',
      'media',
      row.publicId,
      { variant: 'thumb' }
    )
  })

  it('403 without media_evidence', async () => {
    grant(false, false)
    const res = await request(app)
      .get(`/api/media/${row.publicId}/thumb`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
    expect(mockedAudit.auditFromRequest).not.toHaveBeenCalled()
  })

  it('the EXIF original needs the SECOND grant (media_original)', async () => {
    grant(true, false)
    const denied = await request(app)
      .get(`/api/media/${row.publicId}/original`)
      .set('Authorization', `Bearer ${token}`)
    expect(denied.status).toBe(403)

    grant(true, true)
    const served = await request(app)
      .get(`/api/media/${row.publicId}/original`)
      .set('Authorization', `Bearer ${token}`)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toContain('image/jpeg')
    // The served original is byte-exact — EXIF intact, chain of custody.
    expect((await sharp(served.body).metadata()).exif).toBeDefined()
  })

  it('404 for the original when the reporter chose discard (decision 130)', async () => {
    grant(true, true)
    mockedRepository.findByPublicId.mockResolvedValue({ ...row, keepOriginal: false })
    const res = await request(app)
      .get(`/api/media/${row.publicId}/original`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('blocked media stays readable on the panel (preserved for authority)', async () => {
    grant(true, false)
    mockedRepository.findByPublicId.mockResolvedValue({ ...row, status: 'blocked' })
    const res = await request(app)
      .get(`/api/media/${row.publicId}/normalized`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('crypto-shredded media is gone for the panel too', async () => {
    grant(true, true)
    mockedRepository.findByPublicId.mockResolvedValue({
      ...row,
      status: 'deleted',
      dekWrapped: null,
    })
    const res = await request(app)
      .get(`/api/media/${row.publicId}/normalized`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})
