import { createHash, createHmac } from 'crypto'

/**
 * Minimal AWS Signature V4 signer — enough for path-style S3 object
 * operations (PUT/GET/DELETE) against MinIO or any S3-compatible provider
 * (decision 126). Written in-house on the same grounds as the TOTP
 * implementation (decision 114): a small, fully-testable primitive beats a
 * megabyte-scale SDK dependency for three HTTP verbs.
 *
 * Reference: AWS SigV4 documented derivation; the signing-key test vector
 * in sigv4.spec.ts comes from the official documentation example.
 */

export interface SignInput {
  method: 'GET' | 'PUT' | 'DELETE'
  host: string
  /** Absolute path, already starting with '/'. Encoded by canonicalUri. */
  path: string
  region: string
  accessKey: string
  secretKey: string
  payloadHash: string
  /** YYYYMMDD'T'HHMMSS'Z' */
  amzDate: string
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** RFC 3986 encoding per path segment, '/' preserved. */
export function canonicalUri(path: string): string {
  return path
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    )
    .join('/')
}

export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

/** Returns the headers (Authorization included) for the request. */
export function signRequest(input: SignInput): Record<string, string> {
  const dateStamp = input.amzDate.slice(0, 8)
  const service = 's3'
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    input.method,
    canonicalUri(input.path),
    '', // no query string in object PUT/GET/DELETE
    `host:${input.host}\n` +
      `x-amz-content-sha256:${input.payloadHash}\n` +
      `x-amz-date:${input.amzDate}\n`,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signature = createHmac(
    'sha256',
    deriveSigningKey(input.secretKey, dateStamp, input.region, service)
  )
    .update(stringToSign, 'utf8')
    .digest('hex')

  return {
    Host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': input.amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

export function amzDateNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
