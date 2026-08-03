import * as repository from '@modules/users/user.repository'
import * as store from '@shared/acl/privilege-store'
import { deleteUser, syncUserPrivileges } from '@modules/users/user.service'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/users/user.repository')
jest.mock('@shared/acl/privilege-store')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedStore = store as jest.Mocked<typeof store>

const user = { id: 2, name: 'Ana', email: 'ana@vgr.com.br', active: 'S' as const, locale: null, lastLoginAt: null }

const CATALOG = [
  { id: 1, description: 'VIEW' },
  { id: 2, description: 'INSERT' },
  { id: 3, description: 'UPDATE' },
  { id: 4, description: 'DELETE' },
]

describe('user.service syncUserPrivileges', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findUserById.mockResolvedValue(user)
    mockedRepository.findInterfaceKey.mockResolvedValue('risk_config')
    mockedRepository.listInterfaceCatalogPrivileges.mockResolvedValue(CATALOG)
  })

  it('granting any privilege implies VIEW (setes rule, by name — decision 71)', async () => {
    await syncUserPrivileges(2, 1, [3], 99)

    const [, , granted] = mockedRepository.syncUserInterfacePrivileges.mock.calls[0]
    expect(granted).toEqual(expect.arrayContaining([3, 1]))
    expect(mockedStore.invalidateUserPrivileges).toHaveBeenCalledWith(2)
  })

  it('rejects privileges not cataloged for the interface with 422', async () => {
    await expect(syncUserPrivileges(2, 1, [999], 99)).rejects.toMatchObject({ statusCode: 422 })
    expect(mockedRepository.syncUserInterfacePrivileges).not.toHaveBeenCalled()
  })

  it('an empty list revokes everything (no implied VIEW)', async () => {
    await syncUserPrivileges(2, 1, [], 99)

    const [, , granted] = mockedRepository.syncUserInterfacePrivileges.mock.calls[0]
    expect(granted).toEqual([])
  })

  it('blocks the Admin from revoking their own access to the Users screen (lockout guard)', async () => {
    mockedRepository.findInterfaceKey.mockResolvedValue('users')

    await expect(syncUserPrivileges(2, 6, [], 2)).rejects.toThrow(HttpError)
    expect(mockedRepository.syncUserInterfacePrivileges).not.toHaveBeenCalled()
  })
})

describe('user.service deleteUser', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findUserById.mockResolvedValue(user)
  })

  it('blocks self-deletion — no super user exists to recover access (decision 70)', async () => {
    await expect(deleteUser(2, 2)).rejects.toMatchObject({ statusCode: 409 })
    expect(mockedRepository.softDeleteUser).not.toHaveBeenCalled()
  })

  it('soft-deletes another user and invalidates their cached ACL', async () => {
    await deleteUser(2, 99)

    expect(mockedRepository.softDeleteUser).toHaveBeenCalledWith(2)
    expect(mockedStore.invalidateUserPrivileges).toHaveBeenCalledWith(2)
  })
})
