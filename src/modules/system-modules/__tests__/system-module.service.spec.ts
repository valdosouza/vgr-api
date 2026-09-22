import * as repository from '@modules/system-modules/system-module.repository'
import { listSystemModules } from '@modules/system-modules/system-module.service'
import { SystemModuleRow } from '@modules/system-modules/system-module.interface'

jest.mock('@modules/system-modules/system-module.repository')

const mockedRepository = repository as jest.Mocked<typeof repository>

const row: SystemModuleRow = {
  id: 2,
  description: 'Administration',
  i18nKey: 'administration',
  imageIcon: null,
  position: 0,
  interfaceIds: [4, 5],
}

/** PS0 (decision 220): the service composes the two list shapes. */
describe('system-module.service listSystemModules paging (decision 220)', () => {
  beforeEach(() => jest.resetAllMocks())

  it('without page returns the plain array and never counts', async () => {
    mockedRepository.listSystemModules.mockResolvedValue([row])

    await expect(listSystemModules({ pageSize: 20, filter: 'adm' })).resolves.toEqual([row])

    expect(mockedRepository.listSystemModules).toHaveBeenCalledWith('adm', undefined)
    expect(mockedRepository.countSystemModules).not.toHaveBeenCalled()
  })

  it('with page=2&pageSize=10 passes LIMIT 10 OFFSET 10 and returns the paged shape', async () => {
    mockedRepository.countSystemModules.mockResolvedValue(11)
    mockedRepository.listSystemModules.mockResolvedValue([row])

    await expect(listSystemModules({ page: 2, pageSize: 10 })).resolves.toEqual({
      items: [row],
      page: 2,
      pageSize: 10,
      total: 11,
    })

    expect(mockedRepository.listSystemModules).toHaveBeenCalledWith(undefined, { limit: 10, offset: 10 })
  })
})
