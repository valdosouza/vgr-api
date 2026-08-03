import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { BlobStore } from '@shared/storage/blob-store'

/**
 * Local-disk adapter — step 0 of decision 126 (dev/test; zero infra to run
 * the suite). Keys are generated internally, but the path is still
 * confined to the root: a key that escapes it is a bug, and we fail loudly
 * instead of touching whatever it pointed at.
 */
export class FsBlobStore implements BlobStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathOf(key: string): string {
    const path = resolve(join(this.root, key))
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error('Blob key escapes the storage root')
    }
    return path
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key))
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      throw err
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true })
  }
}
