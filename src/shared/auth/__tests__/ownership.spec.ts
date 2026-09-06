import { ownsByAccountOrKey } from '@shared/auth/ownership'

/** Decision 134's bearer-secret pattern, as reports (R3), chat, rating and
 *  panic each restated it before it became one implementation. */
describe('ownsByAccountOrKey (decision 134 pattern)', () => {
  const owner = { accountId: 7, clientKey: 'key-abc' }

  it('is true when the actor holds the owning account', () => {
    expect(ownsByAccountOrKey(owner, { accountId: 7, clientKey: null })).toBe(true)
  })

  it('is true when an anonymous actor presents the bearer clientKey (137)', () => {
    expect(ownsByAccountOrKey(owner, { accountId: null, clientKey: 'key-abc' })).toBe(true)
  })

  it('is true when a different account presents the bearer clientKey', () => {
    expect(ownsByAccountOrKey(owner, { accountId: 99, clientKey: 'key-abc' })).toBe(true)
  })

  it('is false for another account without the key', () => {
    expect(ownsByAccountOrKey(owner, { accountId: 99, clientKey: null })).toBe(false)
  })

  it('is false for an anonymous actor with the wrong key', () => {
    expect(ownsByAccountOrKey(owner, { accountId: null, clientKey: 'key-xyz' })).toBe(false)
  })

  it('is false for an anonymous actor with no key at all', () => {
    expect(ownsByAccountOrKey(owner, { accountId: null, clientKey: null })).toBe(false)
  })

  it('never matches an anonymous owner (null account) against an anonymous actor', () => {
    const anonymousOwner = { accountId: null, clientKey: 'key-abc' }
    expect(ownsByAccountOrKey(anonymousOwner, { accountId: null, clientKey: null })).toBe(false)
  })

  it('still lets the anonymous owner in by the key alone', () => {
    const anonymousOwner = { accountId: null, clientKey: 'key-abc' }
    expect(ownsByAccountOrKey(anonymousOwner, { accountId: null, clientKey: 'key-abc' })).toBe(true)
  })
})
