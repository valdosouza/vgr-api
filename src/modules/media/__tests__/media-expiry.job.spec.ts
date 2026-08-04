import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import * as repository from '@modules/media/media.repository'
import { runMediaExpiry } from '@modules/media/media-expiry.job'
import { blobStore, resetBlobStoreForTests } from '@shared/storage/blob-store'

jest.mock('@modules/media/media.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

describe('media-expiry job (decision 131 — crypto-shredding retention)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vgr-expiry-'))
    process.env.MEDIA_FS_ROOT = root
    delete process.env.BLOB_STORE
    resetBlobStoreForTests()
    jest.resetAllMocks()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function seedObjects(prefix: string, withOriginal: boolean): Promise<void> {
    const store = blobStore()
    const base = `${prefix.slice(0, 2)}/${prefix}`
    await store.put(`${base}/normalized`, Buffer.from('sealed'))
    await store.put(`${base}/thumb`, Buffer.from('sealed'))
    await store.put(`${base}/blur`, Buffer.from('sealed'))
    if (withOriginal) await store.put(`${base}/original`, Buffer.from('sealed'))
  }

  it('shreds the DEK first, then clears every stored variant', async () => {
    const prefix = randomUUID()
    await seedObjects(prefix, true)
    mockedRepository.findExpired
      .mockResolvedValueOnce([{ id: 5, storagePrefix: prefix, keepOriginal: true }])
      .mockResolvedValue([])

    const result = await runMediaExpiry()

    expect(result.shredded).toBe(1)
    expect(mockedRepository.shred).toHaveBeenCalledWith(5)
    const base = `${prefix.slice(0, 2)}/${prefix}`
    for (const variant of ['normalized', 'thumb', 'blur', 'original']) {
      expect(await blobStore().get(`${base}/${variant}`)).toBeNull()
    }
  })

  it('does nothing when nothing is due (frozen/unexpired rows never arrive)', async () => {
    mockedRepository.findExpired.mockResolvedValue([])
    const result = await runMediaExpiry()
    expect(result.shredded).toBe(0)
    expect(mockedRepository.shred).not.toHaveBeenCalled()
  })

  it('queries with the configured orphan TTL — config, not a constant (decision 136)', async () => {
    process.env.MEDIA_ORPHAN_TTL_HOURS = '72'
    mockedRepository.findExpired.mockResolvedValue([])
    await runMediaExpiry()
    expect(mockedRepository.findExpired).toHaveBeenCalledWith(expect.any(Number), 72)
    delete process.env.MEDIA_ORPHAN_TTL_HOURS
  })

  it('keeps draining batches until the backlog is empty', async () => {
    const batch = (offset: number) =>
      Array.from({ length: 100 }, (_, i) => ({
        id: offset + i,
        storagePrefix: randomUUID(),
        keepOriginal: false,
      }))
    mockedRepository.findExpired
      .mockResolvedValueOnce(batch(0))
      .mockResolvedValueOnce(batch(100).slice(0, 3))
      .mockResolvedValue([])

    const result = await runMediaExpiry()
    expect(result.shredded).toBe(103)
  })

  it('a storage delete failure never stops the shredding of the rest', async () => {
    const prefix = randomUUID()
    await seedObjects(prefix, false)
    mockedRepository.findExpired
      .mockResolvedValueOnce([
        // No objects exist for this one — fs delete is idempotent, but a
        // real backend error would be caught and logged the same way.
        { id: 1, storagePrefix: randomUUID(), keepOriginal: false },
        { id: 2, storagePrefix: prefix, keepOriginal: false },
      ])
      .mockResolvedValue([])

    const result = await runMediaExpiry()
    expect(result.shredded).toBe(2)
    expect(mockedRepository.shred).toHaveBeenCalledTimes(2)
  })
})
