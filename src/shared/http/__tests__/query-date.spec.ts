import { isDateOnly, queryDate, toDateBounds } from '@shared/http/query-date'
import { FieldErrorCodes } from '@shared/errors/error-codes'
import { zodToFields } from '@shared/http/controller-utils'

const DAY_MS = 24 * 60 * 60 * 1000

/** Promoted from reports-admin.dto (B1) so that any panel module with a
 *  date filter — B5's admin-audit first — shares ONE rule without one
 *  module importing another. */
describe('shared/http/query-date', () => {
  describe('queryDate', () => {
    it('accepts YYYY-MM-DD', () => {
      expect(queryDate.safeParse('2026-09-02').success).toBe(true)
    })

    it('accepts an ISO date-time', () => {
      expect(queryDate.safeParse('2026-09-02T10:15:00.000Z').success).toBe(true)
    })

    it('rejects free text with the INVALID_FORMAT field code (decision 83)', () => {
      const parsed = queryDate.safeParse('yesterday')
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(zodToFields(parsed.error)[0].code).toBe(FieldErrorCodes.INVALID_FORMAT)
      }
    })

    it('rejects an impossible date-time', () => {
      expect(queryDate.safeParse('2026-13-45T99:00:00Z').success).toBe(false)
    })
  })

  describe('isDateOnly', () => {
    it('is true only for the bare YYYY-MM-DD form', () => {
      expect(isDateOnly('2026-09-02')).toBe(true)
      expect(isDateOnly('2026-09-02T00:00:00.000Z')).toBe(false)
    })
  })

  describe('toDateBounds — the B1 semantics', () => {
    it('from is inclusive at midnight UTC when date-only', () => {
      expect(toDateBounds({ from: '2026-09-02' })).toEqual({
        createdFrom: new Date('2026-09-02T00:00:00.000Z'),
      })
    })

    it('from is the instant itself when a date-time was given', () => {
      expect(toDateBounds({ from: '2026-09-02T10:15:00.000Z' })).toEqual({
        createdFrom: new Date('2026-09-02T10:15:00.000Z'),
      })
    })

    it('a date-only `to` covers the whole day: bound is the NEXT midnight, exclusive', () => {
      expect(toDateBounds({ to: '2026-09-02' })).toEqual({
        createdTo: new Date(new Date('2026-09-02T00:00:00.000Z').getTime() + DAY_MS),
        createdToExclusive: true,
      })
    })

    it('a date-time `to` is inclusive', () => {
      expect(toDateBounds({ to: '2026-09-02T10:15:00.000Z' })).toEqual({
        createdTo: new Date('2026-09-02T10:15:00.000Z'),
        createdToExclusive: false,
      })
    })

    it('no input, no bounds', () => {
      expect(toDateBounds({})).toEqual({})
    })
  })
})
