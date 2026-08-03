import * as repository from '@modules/privileges/privilege.repository'
import * as store from '@shared/acl/privilege-store'
import { createPrivilege, deletePrivilege } from '@modules/privileges/privilege.service'

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
