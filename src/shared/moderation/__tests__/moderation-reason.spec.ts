import {
  MODERATION_REASONS,
  moderationReasonDto,
} from '@shared/moderation/moderation-reason'
import { zodToFields } from '@shared/http/controller-utils'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/** Decision 163: fixed catalog in code; free-text note mandatory on `other`. */
describe('moderation reason catalog (decision 163)', () => {
  it('is exactly the six canonical English codes, in the decided order', () => {
    expect(MODERATION_REASONS).toEqual([
      'spam',
      'abuse',
      'illegal_content',
      'duplicate',
      'personal_data',
      'other',
    ])
  })

  it('accepts a catalog code without a note', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'spam' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ reasonCode: 'spam' })
  })

  it('accepts a catalog code with an optional trimmed note', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'abuse', note: '  threats in the text  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ reasonCode: 'abuse', note: 'threats in the text' })
  })

  it('an unknown code is INVALID_OPTION on reasonCode (decision 83)', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'rude' })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(zodToFields(r.error)).toEqual([
      expect.objectContaining({ field: 'reasonCode', code: FieldErrorCodes.INVALID_OPTION }),
    ])
  })

  it('a missing reasonCode is REQUIRED', () => {
    const r = moderationReasonDto.safeParse({})
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)).toEqual([
      expect.objectContaining({ field: 'reasonCode', code: FieldErrorCodes.REQUIRED }),
    ])
  })

  it('`other` without a note is REQUIRED on note', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'other' })
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)).toEqual([
      expect.objectContaining({ field: 'note', code: FieldErrorCodes.REQUIRED }),
    ])
  })

  it('`other` with a blank note is still REQUIRED (whitespace is not a reason)', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'other', note: '   ' })
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)[0]).toMatchObject({ field: 'note', code: FieldErrorCodes.REQUIRED })
  })

  it('`other` with a note under 3 chars is TOO_SHORT on note', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'other', note: 'ab' })
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)).toEqual([
      expect.objectContaining({ field: 'note', code: FieldErrorCodes.TOO_SHORT }),
    ])
  })

  it('`other` with a 3-char note passes', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'other', note: 'abc' })
    expect(r.success).toBe(true)
  })

  it('a note over 500 chars is TOO_LONG for any code', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'spam', note: 'x'.repeat(501) })
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)).toEqual([
      expect.objectContaining({ field: 'note', code: FieldErrorCodes.TOO_LONG }),
    ])
  })

  it('an empty note on a non-other code is dropped, never stored as ""', () => {
    const r = moderationReasonDto.safeParse({ reasonCode: 'duplicate', note: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ reasonCode: 'duplicate' })
  })
})
