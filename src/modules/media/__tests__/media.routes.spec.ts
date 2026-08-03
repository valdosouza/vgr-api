import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import request from 'supertest'
import sharp from 'sharp'
import app from '../../../app'
import * as repository from '@modules/media/media.repository'
import { signAppAccessToken } from '@shared/auth/app-session'
import * as accountRepository from '@modules/accounts/account.repository'
import { resetBlobStoreForTests } from '@shared/storage/blob-store'

jest.mock('@modules/media/media.repository')
jest.mock('@modules/accounts/account.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>

describe('/app-media routes (decisions 126-131)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vgr-media-routes-'))
    process.env.JWT_SECRET = 'test-secret'
    process.env.MEDIA_KEK = randomBytes(32).toString('base64')
    process.env.MEDIA_FS_ROOT = root
    delete process.env.BLOB_STORE
    resetBlobStoreForTests()
    jest.resetAllMocks()
    mockedRepository.insertMedia.mockResolvedValue(1)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts an ANONYMOUS multipart upload (decisions 32/35 — no token, no account)', async () => {
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#c00' } })
      .jpeg()
      .toBuffer()

    const res = await request(app).post('/app-media').attach('file', jpeg, 'photo.jpg')

    expect(res.status).toBe(201)
    expect(res.body.publicId).toBeDefined()
    expect(res.body.mime).toBe('image/webp')
    expect(mockedRepository.insertMedia.mock.calls[0][0].uploaderAccountId).toBeNull()
  })

  it('records the uploader when an app token is present', async () => {
    mockedAccounts.findAccountById.mockResolvedValue({
      id: 7,
      displayName: 'Ana',
      email: 'ana@example.com',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      passwordHash: null,
      jurisdiction: 'BR',
      consentVersion: 'v1',
      sessionVersion: 1,
      failedLoginCount: 0,
      totpSecret: null,
      totpEnabled: false,
      active: true,
    })
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#c00' } })
      .jpeg()
      .toBuffer()

    const res = await request(app)
      .post('/app-media')
      .set('Authorization', `Bearer ${signAppAccessToken(7, 1)}`)
      .attach('file', jpeg, 'photo.jpg')

    expect(res.status).toBe(201)
    expect(mockedRepository.insertMedia.mock.calls[0][0].uploaderAccountId).toBe(7)
  })

  it('422 without a file, with the decision-83 field contract', async () => {
    const res = await request(app).post('/app-media')
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_FAILED')
    expect(res.body.fields[0].field).toBe('file')
  })

  it('422 for non-image bytes', async () => {
    const res = await request(app)
      .post('/app-media')
      .attach('file', Buffer.from('%PDF-1.4 definitely not pixels'), 'evil.jpg')
    expect(res.status).toBe(422)
  })

  it('reading media requires app authentication (owner-only route)', async () => {
    const res = await request(app).get('/app-media/some-id/normalized')
    expect(res.status).toBe(401)
  })
})
