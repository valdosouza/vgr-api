import { z } from 'zod'
import { zodToFields } from '@shared/http/controller-utils'
import { FieldErrorCodes } from '@shared/errors/error-codes'

/** Decision 83: the per-field `code` is the i18n contract. */
describe('zodToFields (decision 83)', () => {
  it('maps a custom refinement to the code it declares in params', () => {
    const schema = z.object({
      taxId: z.string().refine(() => false, {
        message: 'Invalid check digits',
        params: { code: FieldErrorCodes.INVALID_FORMAT },
      }),
    })
    const r = schema.safeParse({ taxId: 'x' })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(zodToFields(r.error)).toEqual([
      { field: 'taxId', message: 'Invalid check digits', code: FieldErrorCodes.INVALID_FORMAT },
    ])
  })

  it('falls back to INVALID_VALUE for a custom refinement without a declared code', () => {
    const schema = z.object({ n: z.number().refine(() => false, { message: 'nope' }) })
    const r = schema.safeParse({ n: 1 })
    if (r.success) throw new Error('expected failure')
    expect(zodToFields(r.error)[0].code).toBe(FieldErrorCodes.INVALID_VALUE)
  })

  it('keeps the existing mappings (required, too short, regex → INVALID_FORMAT)', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().min(3),
      c: z.string().regex(/^\d+$/),
    })
    const r = schema.safeParse({ b: 'xy', c: 'abc' })
    if (r.success) throw new Error('expected failure')
    const byField = Object.fromEntries(zodToFields(r.error).map((f) => [f.field, f]))
    expect(byField.a.code).toBe(FieldErrorCodes.REQUIRED)
    expect(byField.b).toEqual(expect.objectContaining({ code: FieldErrorCodes.TOO_SHORT, params: { min: '3' } }))
    expect(byField.c.code).toBe(FieldErrorCodes.INVALID_FORMAT)
  })
})
