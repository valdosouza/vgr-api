import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { FsBlobStore } from '@shared/storage/fs-blob-store'

describe('FsBlobStore (decision 126 — step 0)', () => {
  let root: string
  let store: FsBlobStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vgr-blob-'))
    store = new FsBlobStore(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('round-trips put/get/delete', async () => {
    const data = randomBytes(256)
    await store.put('ab/prefix-1/normalized', data)
    const read = await store.get('ab/prefix-1/normalized')
    expect(read?.equals(data)).toBe(true)

    await store.delete('ab/prefix-1/normalized')
    expect(await store.get('ab/prefix-1/normalized')).toBeNull()
  })

  it('returns null for a missing object', async () => {
    expect(await store.get('no/such/key')).toBeNull()
  })

  it('delete of a missing object is idempotent', async () => {
    await expect(store.delete('no/such/key')).resolves.toBeUndefined()
  })

  it('refuses keys that escape the storage root', async () => {
    await expect(store.put('../escape', Buffer.from('x'))).rejects.toThrow('escapes')
  })
})
