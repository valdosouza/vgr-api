import { canonicalUri, deriveSigningKey, signRequest } from '@shared/storage/sigv4'

describe('sigv4 (decision 126 — in-house S3 signer)', () => {
  it('derives the signing key per the official AWS documentation vector', () => {
    // AWS SigV4 documented example: secret, 20120215, us-east-1, iam.
    const key = deriveSigningKey(
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      '20120215',
      'us-east-1',
      'iam'
    )
    expect(key.toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d'
    )
  })

  it('encodes path segments but preserves separators', () => {
    expect(canonicalUri('/bucket/ab/cd ef')).toBe('/bucket/ab/cd%20ef')
    expect(canonicalUri("/b/it's")).toBe('/b/it%27s')
  })

  it('produces a stable Authorization header shape', () => {
    const headers = signRequest({
      method: 'PUT',
      host: '127.0.0.1:9000',
      path: '/vgr-media/ab/abc/normalized',
      region: 'us-east-1',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'secret',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      amzDate: '20260803T120000Z',
    })
    expect(headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260803\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    )
    expect(headers['x-amz-date']).toBe('20260803T120000Z')
    expect(headers.Host).toBe('127.0.0.1:9000')
  })

  it('signature changes with the payload hash (content is bound)', () => {
    const base = {
      method: 'PUT' as const,
      host: 'h',
      path: '/b/k',
      region: 'us-east-1',
      accessKey: 'ak',
      secretKey: 'sk',
      amzDate: '20260803T120000Z',
    }
    const a = signRequest({ ...base, payloadHash: 'a'.repeat(64) })
    const b = signRequest({ ...base, payloadHash: 'b'.repeat(64) })
    expect(a.Authorization).not.toBe(b.Authorization)
  })
})
