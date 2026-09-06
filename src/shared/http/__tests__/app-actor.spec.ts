import { Request } from 'express'
import { appActorOf } from '@shared/http/app-actor'

/** Express lowercases incoming header names, so `req.headers` is keyed by
 *  the lowercase form — the shape the helper reads. */
function requestOf(over: {
  appAccountId?: number
  headers?: Record<string, string | string[] | undefined>
  ip?: string
}): Request {
  return { headers: {}, ...over } as unknown as Request
}

describe('appActorOf', () => {
  it('reads the app account appAuthMiddleware set', () => {
    expect(appActorOf(requestOf({ appAccountId: 42, ip: '10.0.0.1' }))).toEqual({
      accountId: 42,
      clientKey: null,
      ip: '10.0.0.1',
    })
  })

  it('is anonymous (null account) when no app session is present', () => {
    expect(appActorOf(requestOf({ ip: '10.0.0.1' })).accountId).toBeNull()
  })

  it('takes the bearer clientKey from the x-client-key HEADER (134/137)', () => {
    const actor = appActorOf(requestOf({ headers: { 'x-client-key': 'key-abc' }, ip: '10.0.0.1' }))
    expect(actor).toEqual({ accountId: null, clientKey: 'key-abc', ip: '10.0.0.1' })
  })

  it('carries both the account and the key when both are present', () => {
    const actor = appActorOf(
      requestOf({ appAccountId: 42, headers: { 'x-client-key': 'key-abc' }, ip: '10.0.0.1' })
    )
    expect(actor).toEqual({ accountId: 42, clientKey: 'key-abc', ip: '10.0.0.1' })
  })

  it('treats an empty x-client-key as no key', () => {
    expect(appActorOf(requestOf({ headers: { 'x-client-key': '' } })).clientKey).toBeNull()
  })

  it('treats a repeated x-client-key (array) as no key — only one value is a credential', () => {
    expect(appActorOf(requestOf({ headers: { 'x-client-key': ['a', 'b'] } })).clientKey).toBeNull()
  })

  it('falls back to an empty ip when Express has none', () => {
    expect(appActorOf(requestOf({})).ip).toBe('')
  })
})
