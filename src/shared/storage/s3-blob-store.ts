import { BlobStore } from '@shared/storage/blob-store'
import { amzDateNow, sha256Hex, signRequest } from '@shared/storage/sigv4'

/**
 * S3-compatible adapter — steps 1 and 2 of decision 126: the SAME adapter
 * talks to self-hosted MinIO in the MVP and to whichever paid provider
 * wins the open round-7 item later. Path-style URLs on purpose (MinIO's
 * default; every S3-compatible provider accepts them).
 *
 * Objects are ciphertext before they get here (media-cipher.ts) — this
 * class never sees a plaintext image.
 */
export class S3BlobStore implements BlobStore {
  constructor(
    private readonly config: {
      endpoint: string
      region: string
      bucket: string
      accessKey: string
      secretKey: string
    }
  ) {}

  private async request(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: Buffer
  ): Promise<Response> {
    const { endpoint, region, bucket, accessKey, secretKey } = this.config
    const url = new URL(endpoint)
    const path = `/${bucket}/${key}`
    const payloadHash = sha256Hex(body ?? '')
    const headers = signRequest({
      method,
      host: url.host,
      path,
      region,
      accessKey,
      secretKey,
      payloadHash,
      amzDate: amzDateNow(),
    })
    // Buffer satisfies the body type at runtime; BodyInit itself lives in
    // undici-types, which this tsconfig's lib does not surface by name.
    const init = { method, headers, body } as Parameters<typeof fetch>[1]
    return fetch(`${endpoint}${path}`, init)
  }

  async put(key: string, data: Buffer): Promise<void> {
    const res = await this.request('PUT', key, data)
    if (!res.ok) {
      throw new Error(`Blob PUT failed: ${res.status} ${await res.text()}`)
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.request('GET', key)
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`Blob GET failed: ${res.status} ${await res.text()}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', key)
    // S3 DELETE is idempotent: 204 for present and absent alike.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Blob DELETE failed: ${res.status} ${await res.text()}`)
    }
  }
}
