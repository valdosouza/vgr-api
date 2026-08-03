import { createRole, createAnonymityMode, transitionRole } from '@modules/identity/identity.service'

describe('identity.service', () => {
  describe('createRole', () => {
    it.each(['anonymous', 'reporter', 'helper', 'police'])('creates Role successfully for %s', (value) => {
      expect(createRole(value)).toBe(value)
    })

    it('rejects an unknown role value', () => {
      expect(() => createRole('superadmin')).toThrow()
    })
  })

  describe('createAnonymityMode', () => {
    it('rejects identified_with_reward when no completed UserAccount registration exists (decision 4)', () => {
      expect(() => createAnonymityMode('identified_with_reward', false)).toThrow()
    })

    it('accepts identified_with_reward when registration is completed', () => {
      expect(createAnonymityMode('identified_with_reward', true)).toBe('identified_with_reward')
    })

    it('accepts anonymous regardless of registration status', () => {
      expect(createAnonymityMode('anonymous', false)).toBe('anonymous')
    })
  })

  describe('transitionRole', () => {
    it('allows Role transition from anonymous to reporter', () => {
      expect(transitionRole('anonymous', 'reporter')).toBe('reporter')
    })

    it('allows Role transition from anonymous to helper', () => {
      expect(transitionRole('anonymous', 'helper')).toBe('helper')
    })

    it('rejects Role transition to police (deferred, decision 12)', () => {
      expect(() => transitionRole('anonymous', 'police')).toThrow()
    })
  })
})
