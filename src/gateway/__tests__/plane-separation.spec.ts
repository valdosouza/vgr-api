import { Request, Response } from 'express'
import { authMiddleware } from '@gateway/auth.middleware'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import { signAppAccessToken } from '@shared/auth/app-session'
import { signSession } from '@modules/auth/admin-login.service'
import * as sessionStore from '@shared/acl/session-store'
import * as accountRepository from '@modules/accounts/account.repository'

jest.mock('@shared/acl/session-store')
jest.mock('@modules/accounts/account.repository')

const mockedSessionStore = sessionStore as jest.Mocked<typeof sessionStore>
const mockedAccounts = accountRepository as jest.Mocked<typeof accountRepository>

function makeRes(): Response {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function reqWith(token: string): Request {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request
}

/**
 * Decision 119: the two authentication planes never cross. These are the
 * tests that make it structural rather than a convention — a weakness in
 * the app plane must never reach the panel that grants privileges and
 * decrypts life-at-risk data.
 */
describe('auth plane separation (decision 119)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.JWT_SECRET = 'test-secret'
    mockedSessionStore.getSessionInfo.mockResolvedValue({ sessionVersion: 1, active: true })
    mockedAccounts.findAccountById.mockResolvedValue({
      id: 1,
      displayName: 'Ana',
      email: 'ana@example.com',
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      passwordHash: null,
      jurisdiction: 'BR',
      consentVersion: 'v1',
      sessionVersion: 1,
      failedLoginCount: 0,
      totpSecret: null,
      totpEnabled: false,
      active: true,
    })
  })

  it('rejects an APP token on a panel route', async () => {
    const res = makeRes()
    const next = jest.fn()

    await authMiddleware(reqWith(signAppAccessToken(1, 1)), res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a PANEL token on an app route', async () => {
    const res = makeRes()
    const next = jest.fn()

    await appAuthMiddleware(reqWith(signSession(1, 1)), res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('accepts each token on its own plane', async () => {
    const panelNext = jest.fn()
    await authMiddleware(reqWith(signSession(1, 1)), makeRes(), panelNext)
    expect(panelNext).toHaveBeenCalled()

    const appNext = jest.fn()
    const appReq = reqWith(signAppAccessToken(1, 1))
    await appAuthMiddleware(appReq, makeRes(), appNext)
    expect(appNext).toHaveBeenCalled()
    expect(appReq.appAccountId).toBe(1)
  })

  it('rejects an app token whose session_version is stale (decision 122)', async () => {
    mockedAccounts.findAccountById.mockResolvedValue({
      id: 1,
      displayName: 'Ana',
      email: null,
      emailVerified: false,
      phone: null,
      phoneVerified: false,
      passwordHash: null,
      jurisdiction: 'BR',
      consentVersion: 'v1',
      sessionVersion: 4,
      failedLoginCount: 0,
      totpSecret: null,
      totpEnabled: false,
      active: true,
    })
    const res = makeRes()

    await appAuthMiddleware(reqWith(signAppAccessToken(1, 3)), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('fails closed when the app account lookup breaks', async () => {
    mockedAccounts.findAccountById.mockRejectedValue(new Error('db down'))
    const res = makeRes()

    await appAuthMiddleware(reqWith(signAppAccessToken(1, 1)), res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(500)
  })
})
