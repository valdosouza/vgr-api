import { Request, Response } from 'express'
import { z } from 'zod'
import { parseBody, parseIdParam, parseQuery, zodToFields } from '@shared/http/controller-utils'
import { ErrorCodes, FieldErrorCodes } from '@shared/errors/error-codes'

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

type ResponseMock = Response & { status: jest.Mock; json: jest.Mock }

function responseMock(): ResponseMock {
  const res = {} as ResponseMock
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  return res
}

function requestOf(over: { params?: Record<string, string>; query?: unknown; body?: unknown }): Request {
  return { params: {}, query: {}, body: undefined, ...over } as unknown as Request
}

/** The named-parameter twin of parseId (:reportId / :threadId / :offerId,
 *  merged from the mount path) — same rule, same 400 envelope. */
describe('parseIdParam', () => {
  it('returns the integer for a named route parameter', () => {
    const res = responseMock()
    expect(parseIdParam(requestOf({ params: { reportId: '12' } }), res, 'reportId')).toBe(12)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('accepts 0, as parseId does', () => {
    const res = responseMock()
    expect(parseIdParam(requestOf({ params: { offerId: '0' } }), res, 'offerId')).toBe(0)
    expect(res.status).not.toHaveBeenCalled()
  })

  it.each([['abc'], ['1.5'], ['-1']])('answers 400 INVALID_ID and null for %p', (raw) => {
    const res = responseMock()
    expect(parseIdParam(requestOf({ params: { threadId: raw } }), res, 'threadId')).toBeNull()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
  })

  it('answers 400 when the named parameter is absent', () => {
    const res = responseMock()
    expect(parseIdParam(requestOf({ params: {} }), res, 'reportId')).toBeNull()
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

/** parseBody's twin for `req.query`: the same 422 VALIDATION_FAILED
 *  envelope, so a query error translates by the same field codes. */
describe('parseQuery', () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1),
    after: z.coerce.number().int().min(0).default(0),
  })

  it('returns the parsed (coerced, defaulted) query on success', () => {
    const res = responseMock()
    expect(parseQuery(schema, requestOf({ query: { limit: '20' } }), res)).toEqual({ limit: 20, after: 0 })
    expect(res.status).not.toHaveBeenCalled()
  })

  it('answers 422 VALIDATION_FAILED with per-field codes and returns null on failure', () => {
    const res = responseMock()
    expect(parseQuery(schema, requestOf({ query: { limit: '0' } }), res)).toBeNull()
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      code: ErrorCodes.VALIDATION_FAILED,
      fields: [
        expect.objectContaining({ field: 'limit', code: FieldErrorCodes.TOO_SHORT, params: { min: '1' } }),
      ],
    })
  })

  it('emits exactly the envelope parseBody emits for the same schema and value', () => {
    const value = { limit: 'abc', after: '-1' }
    const bodyRes = responseMock()
    const queryRes = responseMock()
    expect(parseBody(schema, requestOf({ body: value }), bodyRes)).toBeNull()
    expect(parseQuery(schema, requestOf({ query: value }), queryRes)).toBeNull()
    expect(queryRes.status.mock.calls).toEqual(bodyRes.status.mock.calls)
    expect(queryRes.json.mock.calls).toEqual(bodyRes.json.mock.calls)
  })
})
