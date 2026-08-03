import { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { authMiddleware } from '@gateway/auth.middleware'
import * as sessionStore from '@shared/acl/session-store'

jest.mock('@shared/acl/session-store')

const mockedStore = sessionStore as jest.Mocked<typeof sessionStore>

function makeRes(): Response {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function reqWithToken(payload: object): Request {
  const token = jwt.sign(payload, 'test-secret', { audience: 'admin' })
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request
}

describe('authMiddleware session revocation (decision 112)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.JWT_SECRET = 'test-secret'
  })

  it('accepts a token whose sv matches the stored session_version', async () => {
    mockedStore.getSessionInfo.mockResolvedValue({ sessionVersion: 3, active: true })
    const next = jest.fn()

    await authMiddleware(reqWithToken({ userId: 7, role: 'admin', sv: 3 }), makeRes(), next)

    expect(next).toHaveBeenCalled()
  })

  it('rejects a token from before the last session bump — revocation in <=60s', async () => {
    mockedStore.getSessionInfo.mockResolvedValue({ sessionVersion: 4, active: true })
    const res = makeRes()
    const next = jest.fn()

    await authMiddleware(reqWithToken({ userId: 7, role: 'admin', sv: 3 }), res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a valid-signature token of a deactivated user', async () => {
    mockedStore.getSessionInfo.mockResolvedValue({ sessionVersion: 3, active: false })
    const res = makeRes()

    await authMiddleware(reqWithToken({ userId: 7, role: 'admin', sv: 3 }), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('rejects a pre-S2 token that carries no sv claim at all', async () => {
    mockedStore.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    const res = makeRes()

    await authMiddleware(reqWithToken({ userId: 7, role: 'admin' }), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('fails closed (500) when the session lookup itself breaks', async () => {
    mockedStore.getSessionInfo.mockRejectedValue(new Error('db down'))
    const res = makeRes()
    const next = jest.fn()

    await authMiddleware(reqWithToken({ userId: 7, role: 'admin', sv: 1 }), res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(next).not.toHaveBeenCalled()
  })
})
