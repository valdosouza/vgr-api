import * as repository from '@modules/users/user.repository'
import * as store from '@shared/acl/privilege-store'
import * as sessionStore from '@shared/acl/session-store'
import { deleteUser, listUsers, syncUserPrivileges, updateUser } from '@modules/users/user.service'
import { HttpError } from '@shared/errors/http-error'

jest.mock('@modules/users/user.repository')
jest.mock('@shared/acl/privilege-store')
jest.mock('@shared/acl/session-store')

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

/** PS0 (decision 220): the service composes the two list shapes. */
describe('user.service listUsers paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without page returns the plain array and never counts', async () => {
    mockedRepository.listUsers.mockResolvedValue([user])

    await expect(listUsers({ pageSize: 20, filter: 'ana' })).resolves.toEqual([user])

    expect(mockedRepository.listUsers).toHaveBeenCalledWith('ana', undefined)
    expect(mockedRepository.countUsers).not.toHaveBeenCalled()
  })

  it('with page=2&pageSize=10 passes LIMIT 10 OFFSET 10 and returns the paged shape', async () => {
    mockedRepository.countUsers.mockResolvedValue(11)
    mockedRepository.listUsers.mockResolvedValue([user])

    await expect(listUsers({ page: 2, pageSize: 10, filter: 'ana' })).resolves.toEqual({
      items: [user],
      page: 2,
      pageSize: 10,
      total: 11,
    })

    expect(mockedRepository.countUsers).toHaveBeenCalledWith('ana')
    expect(mockedRepository.listUsers).toHaveBeenCalledWith('ana', { limit: 10, offset: 10 })
  })
})

describe('user.service updateUser — absent fields keep what is saved (decision 230)', () => {
  const saved = { ...user, active: 'N' as const, locale: 'pt-BR' }

  beforeEach(() => {
    jest.resetAllMocks()
    mockedRepository.findUserById.mockResolvedValue(saved)
    mockedRepository.findUserByEmail.mockResolvedValue(saved)
  })

  it('without active and locale keeps both — a deactivated user stays deactivated', async () => {
    await updateUser(2, { name: 'Ana Maria', email: 'ana@vgr.com.br' })

    expect(mockedRepository.updateUser).toHaveBeenCalledWith(
      2,
      { name: 'Ana Maria', email: 'ana@vgr.com.br', active: 'N', locale: 'pt-BR' },
      undefined
    )
    expect(mockedRepository.bumpSessionVersion).not.toHaveBeenCalled()
  })

  it('an explicit locale: null clears it; a sent active is applied', async () => {
    await updateUser(2, { name: 'Ana', email: 'ana@vgr.com.br', active: 'S', locale: null })

    expect(mockedRepository.updateUser).toHaveBeenCalledWith(
      2,
      { name: 'Ana', email: 'ana@vgr.com.br', active: 'S', locale: null },
      undefined
    )
  })

  it('deactivating still revokes the sessions (decision 112)', async () => {
    mockedRepository.findUserById.mockResolvedValue({ ...saved, active: 'S' })

    await updateUser(2, { name: 'Ana', email: 'ana@vgr.com.br', active: 'N' })

    expect(mockedRepository.bumpSessionVersion).toHaveBeenCalledWith(2)
    expect(sessionStore.invalidateSession).toHaveBeenCalledWith(2)
  })
})
