import { Request, Response } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import * as store from '@shared/acl/privilege-store'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'

jest.mock('@shared/acl/privilege-store')

const mockedStore = store as jest.Mocked<typeof store>

function makeRes(): Response {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

function makeReq(method: string, userId?: number): Request {
  return { method, user: userId ? { userId, role: 'admin' } : undefined } as unknown as Request
}

describe('require-privilege.middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('lets a GET through when the user holds VIEW on the interface (decision 72)', async () => {
    mockedStore.userHasPrivilege.mockResolvedValue(true)
    const next = jest.fn()

    await requirePrivilege(InterfaceKeys.USERS)(makeReq('GET', 7), makeRes(), next)

    expect(mockedStore.userHasPrivilege).toHaveBeenCalledWith(7, 'users', 'VIEW')
    expect(next).toHaveBeenCalled()
  })

  it('derives the privilege from the HTTP method (POST→INSERT, PUT→UPDATE, DELETE→DELETE)', async () => {
    mockedStore.userHasPrivilege.mockResolvedValue(true)
    const next = jest.fn()

    await requirePrivilege(InterfaceKeys.PRIVILEGES)(makeReq('POST', 7), makeRes(), next)
    await requirePrivilege(InterfaceKeys.PRIVILEGES)(makeReq('PUT', 7), makeRes(), next)
    await requirePrivilege(InterfaceKeys.PRIVILEGES)(makeReq('DELETE', 7), makeRes(), next)

    expect(mockedStore.userHasPrivilege.mock.calls.map((c) => c[2])).toEqual([
      'INSERT',
      'UPDATE',
      'DELETE',
    ])
  })

  it('responds 403 when the grant is missing — the API is the authority, not the menu', async () => {
    mockedStore.userHasPrivilege.mockResolvedValue(false)
    const res = makeRes()
    const next = jest.fn()

    await requirePrivilege(InterfaceKeys.USERS)(makeReq('GET', 7), res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('honors an explicit privilege override (approve = UPDATE even via POST)', async () => {
    mockedStore.userHasPrivilege.mockResolvedValue(true)
    const next = jest.fn()

    await requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS, Privileges.UPDATE)(
      makeReq('POST', 7),
      makeRes(),
      next
    )

    expect(mockedStore.userHasPrivilege).toHaveBeenCalledWith(7, 'dual_control_access', 'UPDATE')
  })

  it('fails closed with 500 when the ACL lookup itself breaks', async () => {
    mockedStore.userHasPrivilege.mockRejectedValue(new Error('db down'))
    const res = makeRes()
    const next = jest.fn()

    await requirePrivilege(InterfaceKeys.USERS)(makeReq('GET', 7), res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(next).not.toHaveBeenCalled()
  })
})
