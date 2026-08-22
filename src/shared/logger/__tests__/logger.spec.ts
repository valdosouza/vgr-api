import logger from '@shared/logger/logger'

describe('logger (decision 110 — no secret ever reaches a log)', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('redacts password/token/secret/code/key fields before they reach console', () => {
    logger.info('test', {
      password: 'p',
      token: 't',
      secret: 's',
      code: '123456',
      apiKey: 'k',
      name: 'ok',
    })

    expect(logSpy.mock.calls[0][1]).toEqual({
      password: '[redacted]',
      token: '[redacted]',
      secret: '[redacted]',
      code: '[redacted]',
      apiKey: '[redacted]',
      name: 'ok',
    })
  })

  it('redacts ip/body/location fields — invariant 9: IP and location never in a log', () => {
    logger.warn('test', { ip: '1.2.3.4', body: { field: 1 }, location: { lat: 1, lng: 2 }, ok: true })

    expect(warnSpy.mock.calls[0][1]).toEqual({
      ip: '[redacted]',
      body: '[redacted]',
      location: '[redacted]',
      ok: true,
    })
  })

  it('redacts nested objects and arrays recursively', () => {
    logger.error('test', {
      nested: { deep: { token: 'abc' } },
      list: [{ password: 'p' }, { name: 'ok' }],
    })

    expect(errorSpy.mock.calls[0][1]).toEqual({
      nested: { deep: { token: '[redacted]' } },
      list: [{ password: '[redacted]' }, { name: 'ok' }],
    })
  })

  it('leaves Error objects intact — redaction targets meta keys, not error internals', () => {
    const err = new Error('boom')
    logger.error('test', { err })

    expect(errorSpy.mock.calls[0][1]).toEqual({ err })
  })

  it('passes through with no meta — no crash, no extra output', () => {
    logger.info('no meta')

    expect(logSpy.mock.calls[0][1]).toBe('')
  })
})
