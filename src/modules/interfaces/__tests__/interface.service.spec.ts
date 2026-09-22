import * as repository from '@modules/interfaces/interface.repository'
import { listInterfaces } from '@modules/interfaces/interface.service'
import { InterfaceRow } from '@modules/interfaces/interface.interface'

jest.mock('@modules/interfaces/interface.repository')
jest.mock('@shared/acl/privilege-store')

const mockedRepository = repository as jest.Mocked<typeof repository>

const row: InterfaceRow = {
  id: 4,
  description: 'Reports',
  i18nKey: 'reports',
  groupDefault: 'General',
  kind: 'T',
  position: 0,
  privilegeIds: [1],
}

/** PS0 (decision 220): the service composes the two list shapes. */
describe('interface.service listInterfaces paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without page returns the plain array and never counts', async () => {
    mockedRepository.listInterfaces.mockResolvedValue([row])

    await expect(listInterfaces({ pageSize: 20, filter: 'rep' })).resolves.toEqual([row])

    expect(mockedRepository.listInterfaces).toHaveBeenCalledWith('rep', undefined)
    expect(mockedRepository.countInterfaces).not.toHaveBeenCalled()
  })

  it('with page=2&pageSize=10 passes LIMIT 10 OFFSET 10 and returns the paged shape', async () => {
    mockedRepository.countInterfaces.mockResolvedValue(11)
    mockedRepository.listInterfaces.mockResolvedValue([row])

    await expect(listInterfaces({ page: 2, pageSize: 10 })).resolves.toEqual({
      items: [row],
      page: 2,
      pageSize: 10,
      total: 11,
    })

    expect(mockedRepository.countInterfaces).toHaveBeenCalledWith(undefined)
    expect(mockedRepository.listInterfaces).toHaveBeenCalledWith(undefined, { limit: 10, offset: 10 })
  })
})
