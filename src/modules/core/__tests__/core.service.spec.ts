import * as repository from '@modules/core/core.repository'
import * as store from '@shared/acl/privilege-store'
import { getMenus, getPermissions } from '@modules/core/core.service'

jest.mock('@modules/core/core.repository')
jest.mock('@shared/acl/privilege-store')

const mockedRepository = repository as jest.Mocked<typeof repository>
const mockedStore = store as jest.Mocked<typeof store>

describe('core.service getMenus', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedStore.getUserPrivileges.mockResolvedValue(
      new Map([
        ['users', new Set(['VIEW', 'INSERT', 'UPDATE'])],
        ['privileges', new Set(['VIEW'])],
        ['risk_config', new Set(['VIEW'])],
      ])
    )
  })

  it('places VIEW-granted screens under their admin-managed module, in link order', async () => {
    mockedRepository.listVisibleInterfaces.mockResolvedValue([
      { id: 6, description: 'Users', i18nKey: 'users', groupDefault: 'Administration', position: 1 },
      { id: 9, description: 'Privileges', i18nKey: 'privileges', groupDefault: 'Administration', position: 4 },
    ])
    mockedRepository.listModulesWithInterfaceIds.mockResolvedValue([
      { id: 1, description: 'Access Control', i18nKey: 'access_control', imageIcon: null, position: 0, interfaceIds: [9, 6] },
    ])

    const tree = await getMenus(7)

    expect(tree).toHaveLength(1)
    expect(tree[0].description).toBe('Access Control')
    expect(tree[0].interfaces.map((i) => i.i18nKey)).toEqual(['privileges', 'users'])
    expect(tree[0].interfaces[1].privileges).toEqual(expect.arrayContaining(['VIEW', 'INSERT', 'UPDATE']))
  })

  it('groups screens without a module under group_default pseudo-modules', async () => {
    mockedRepository.listVisibleInterfaces.mockResolvedValue([
      { id: 1, description: 'Risk Tier Configuration', i18nKey: 'risk_config', groupDefault: 'Operations', position: 1 },
    ])
    mockedRepository.listModulesWithInterfaceIds.mockResolvedValue([])

    const tree = await getMenus(7)

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBeNull()
    expect(tree[0].description).toBe('Operations')
    expect(tree[0].interfaces[0].i18nKey).toBe('risk_config')
  })

  it('omits modules whose screens the user cannot VIEW — empty menu for zero grants', async () => {
    mockedRepository.listVisibleInterfaces.mockResolvedValue([])
    mockedRepository.listModulesWithInterfaceIds.mockResolvedValue([
      { id: 1, description: 'Access Control', i18nKey: null, imageIcon: null, position: 0, interfaceIds: [6] },
    ])

    const tree = await getMenus(7)

    expect(tree).toEqual([])
  })
})

describe('core.service getPermissions (decision 93)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns every grant keyed by interface, including kind-R resources', async () => {
    mockedStore.getUserPrivileges.mockResolvedValue(
      new Map([
        ['users', new Set(['VIEW', 'UPDATE'])],
        ['user_privileges', new Set(['VIEW', 'UPDATE'])],
      ])
    )

    const permissions = await getPermissions(7)

    expect(permissions).toEqual({
      users: expect.arrayContaining(['VIEW', 'UPDATE']),
      user_privileges: expect.arrayContaining(['VIEW', 'UPDATE']),
    })
  })
})
