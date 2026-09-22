import * as repository from '@modules/privileges/privilege.repository'
import * as store from '@shared/acl/privilege-store'
import { createPrivilege, deletePrivilege, listPrivileges } from '@modules/privileges/privilege.service'

jest.mock('@modules/privileges/privilege.repository')
jest.mock('@shared/acl/privilege-store')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedStore = store as jest.Mocked<typeof store>

describe('privilege.service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('rejects a duplicate description with 409', async () => {
    mockedRepository.findPrivilegeByDescription.mockResolvedValue({ id: 1, description: 'VIEW' })

    await expect(createPrivilege('VIEW')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses to delete a privilege still cataloged or granted somewhere', async () => {
    mockedRepository.findPrivilegeById.mockResolvedValue({ id: 5, description: 'PRINT' })
    mockedRepository.countPrivilegeUsages.mockResolvedValue(3)

    await expect(deletePrivilege(5)).rejects.toMatchObject({ statusCode: 409 })
    expect(mockedRepository.softDeletePrivilege).not.toHaveBeenCalled()
  })

  it('soft-deletes an unused privilege and clears the ACL cache', async () => {
    mockedRepository.findPrivilegeById.mockResolvedValue({ id: 5, description: 'PRINT' })
    mockedRepository.countPrivilegeUsages.mockResolvedValue(0)

    await deletePrivilege(5)

    expect(mockedRepository.softDeletePrivilege).toHaveBeenCalledWith(5)
    expect(mockedStore.invalidateAllPrivileges).toHaveBeenCalled()
  })
})

/** PS0 (decision 220): the service composes the two list shapes. */
describe('privilege.service listPrivileges paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without page returns the plain array and never counts', async () => {
    mockedRepository.listPrivileges.mockResolvedValue([{ id: 1, description: 'VIEW' }])

    await expect(listPrivileges({ pageSize: 20, filter: 'VI' })).resolves.toEqual([
      { id: 1, description: 'VIEW' },
    ])

    expect(mockedRepository.listPrivileges).toHaveBeenCalledWith('VI', undefined)
    expect(mockedRepository.countPrivileges).not.toHaveBeenCalled()
  })

  it('with page=2&pageSize=10 passes LIMIT 10 OFFSET 10 and returns the paged shape', async () => {
    mockedRepository.countPrivileges.mockResolvedValue(11)
    mockedRepository.listPrivileges.mockResolvedValue([{ id: 11, description: 'PRINT' }])

    await expect(listPrivileges({ page: 2, pageSize: 10, filter: 'P' })).resolves.toEqual({
      items: [{ id: 11, description: 'PRINT' }],
      page: 2,
      pageSize: 10,
      total: 11,
    })

    expect(mockedRepository.countPrivileges).toHaveBeenCalledWith('P')
    expect(mockedRepository.listPrivileges).toHaveBeenCalledWith('P', { limit: 10, offset: 10 })
  })
})
