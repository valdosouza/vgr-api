import { Request, Response } from 'express'
import { requireCapability } from '@gateway/require-capability.middleware'
import * as gate from '@shared/legal/legal-gate'
import { Capabilities } from '@shared/legal/capabilities'

jest.mock('@shared/legal/legal-gate')

const mockedGate = gate as jest.Mocked<typeof gate>

function makeRes(): Response {
  const res: any = { locals: {} }
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.setHeader = jest.fn().mockReturnValue(res)
  return res
}

function makeReq(userId?: number): Request {
  return {
    ip: '10.0.0.1',
    user: userId ? { userId, role: 'admin' } : undefined,
  } as unknown as Request
}

describe('require-capability.middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('responds 451 with the LEGAL_BLOCKED code when the gate blocks (decisions 80, 104)', async () => {
    mockedGate.checkCapability.mockResolvedValue({
      allowed: false,
      demo: false,
      degraded: false,
      restricted: false,
      reason: 'unreviewed',
    })
    const res = makeRes()
    const next = jest.fn()

    await requireCapability(Capabilities.REPORT_ANONYMOUS)(makeReq(7), res, next)

    expect(res.status).toHaveBeenCalledWith(451)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Blocked for legal reasons in this jurisdiction',
      code: 'LEGAL_BLOCKED',
      params: { capability: 'report.anonymous', reason: 'unreviewed' },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('passes through and exposes the decision on res.locals when allowed', async () => {
    const decision = {
      allowed: true,
      demo: false,
      degraded: false,
      restricted: true,
      rule: { id: 4, version: 2 },
    }
    mockedGate.checkCapability.mockResolvedValue(decision)
    const res = makeRes()
    const next = jest.fn()

    await requireCapability(Capabilities.REPORT_ANONYMOUS)(makeReq(7), res, next)

    expect(next).toHaveBeenCalled()
    expect((res as any).locals.legalGate).toEqual(decision)
    expect(res.setHeader).not.toHaveBeenCalled()
  })

  it('marks sandbox responses with the demo header (decision 79)', async () => {
    mockedGate.checkCapability.mockResolvedValue({
      allowed: true,
      demo: true,
      degraded: false,
      restricted: false,
    })
    const res = makeRes()

    await requireCapability(Capabilities.REPORT_ANONYMOUS)(makeReq(), res, jest.fn())

    expect(res.setHeader).toHaveBeenCalledWith('X-VGR-Demo', 'true')
  })

  it('forwards user and ip into the audit context', async () => {
    mockedGate.checkCapability.mockResolvedValue({
      allowed: true,
      demo: false,
      degraded: false,
      restricted: false,
    })

    await requireCapability(Capabilities.REPORT_ANONYMOUS)(makeReq(7), makeRes(), jest.fn())

    expect(mockedGate.checkCapability).toHaveBeenCalledWith('report.anonymous', {
      userRef: '7',
      ip: '10.0.0.1',
    })
  })

  it('fails closed with 500 when the gate itself throws (decision 72 posture)', async () => {
    mockedGate.checkCapability.mockRejectedValue(new Error('boom'))
    const res = makeRes()
    const next = jest.fn()

    await requireCapability(Capabilities.REPORT_ANONYMOUS)(makeReq(7), res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(next).not.toHaveBeenCalled()
  })
})
