import { Request, Response } from 'express'
import { parseQuery } from '@shared/http/controller-utils'
import {
  LIMIT_OFFSET_SQL,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  limitOffsetArgs,
  pagedQueryDto,
  pagedOrPlain,
  pageWindow,
} from '@shared/http/paged-query'
import { FieldErrorCodes } from '@shared/errors/error-codes'

type ResponseMock = Response & { status: jest.Mock; json: jest.Mock }

function responseMock(): ResponseMock {
  const res = {} as ResponseMock
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  return res
}

function requestOf(query: unknown): Request {
  return { params: {}, query, body: undefined } as unknown as Request
}

/** Panel list pagination (PS0, decision 220): optional and backward
 *  compatible — no `page` keeps today's plain shape. */
describe('pagedQueryDto (decision 220)', () => {
  it('leaves page undefined when absent and defaults pageSize', () => {
    expect(pagedQueryDto.parse({})).toEqual({ pageSize: PAGE_SIZE_DEFAULT, filter: undefined })
  })

  it('coerces page and pageSize from query strings', () => {
    expect(pagedQueryDto.parse({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10,
      filter: undefined,
    })
  })

  it('trims the filter and treats a blank filter as absent', () => {
    expect(pagedQueryDto.parse({ filter: '  ana ' }).filter).toBe('ana')
    expect(pagedQueryDto.parse({ filter: '   ' }).filter).toBeUndefined()
  })

  it.each([
    [{ page: '0' }, 'page', FieldErrorCodes.TOO_SHORT],
    [{ page: 'abc' }, 'page', FieldErrorCodes.INVALID_VALUE],
    [{ page: '1.5' }, 'page', FieldErrorCodes.INVALID_VALUE],
    [{ pageSize: '0' }, 'pageSize', FieldErrorCodes.TOO_SHORT],
    [{ pageSize: String(PAGE_SIZE_MAX + 1) }, 'pageSize', FieldErrorCodes.TOO_LONG],
    [{ pageSize: '1000' }, 'pageSize', FieldErrorCodes.TOO_LONG],
    [{ filter: 'x'.repeat(101) }, 'filter', FieldErrorCodes.TOO_LONG],
  ])('answers 422 VALIDATION_FAILED through parseQuery for %p', (query, field, code) => {
    const res = responseMock()

    expect(parseQuery(pagedQueryDto, requestOf(query), res)).toBeNull()

    expect(res.status).toHaveBeenCalledWith(422)
    const body = res.json.mock.calls[0][0]
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields).toEqual([expect.objectContaining({ field, code })])
  })

  it('can be extended by a module with its own params', () => {
    const dto = pagedQueryDto.extend({ jurisdiction: pagedQueryDto.shape.filter })
    expect(dto.parse({ page: '1', jurisdiction: 'BR' })).toMatchObject({ page: 1, jurisdiction: 'BR' })
  })
})

describe('pageWindow / limitOffsetArgs', () => {
  it('page 1 starts at offset 0', () => {
    expect(pageWindow(1, 20)).toEqual({ limit: 20, offset: 0 })
  })

  it('page 3 of 10 skips 20 rows', () => {
    expect(pageWindow(3, 10)).toEqual({ limit: 10, offset: 20 })
  })

  it('yields the args in the order of the LIMIT ? OFFSET ? fragment', () => {
    expect(LIMIT_OFFSET_SQL).toBe('LIMIT ? OFFSET ?')
    expect(limitOffsetArgs({ limit: 10, offset: 20 })).toEqual([10, 20])
  })
})

describe('pagedOrPlain', () => {
  const rows = [{ id: 1 }, { id: 2 }]

  it('without page returns the plain list and never counts (legacy shape)', async () => {
    const list = jest.fn().mockResolvedValue(rows)
    const count = jest.fn().mockResolvedValue(99)

    await expect(pagedOrPlain({ pageSize: 20 }, list, count)).resolves.toEqual(rows)

    expect(list).toHaveBeenCalledWith(undefined)
    expect(count).not.toHaveBeenCalled()
  })

  it('with page returns { items, page, pageSize, total } and passes the window to the list', async () => {
    const list = jest.fn().mockResolvedValue(rows)
    const count = jest.fn().mockResolvedValue(42)

    await expect(pagedOrPlain({ page: 2, pageSize: 10 }, list, count)).resolves.toEqual({
      items: rows,
      page: 2,
      pageSize: 10,
      total: 42,
    })

    expect(list).toHaveBeenCalledWith({ limit: 10, offset: 10 })
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('skips the SELECT when the count is zero (mirrors admin-audit)', async () => {
    const list = jest.fn()
    const count = jest.fn().mockResolvedValue(0)

    await expect(pagedOrPlain({ page: 5, pageSize: 10 }, list, count)).resolves.toEqual({
      items: [],
      page: 5,
      pageSize: 10,
      total: 0,
    })

    expect(list).not.toHaveBeenCalled()
  })
})
