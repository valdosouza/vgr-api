import * as repository from '@modules/core/core.repository'
import { MenuInterface, MenuModule, MeRow } from '@modules/core/core.interface'
import { getUserPrivileges } from '@shared/acl/privilege-store'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Assembles the menu tree (decision 71). Single path — no super/contract
 * branches like setes: visibility is decided only by the user's VIEW grants
 * (decisions 69/70). Screens linked to an Admin-managed module appear under
 * it; the rest group under their group_default as pseudo-modules.
 */
export async function getMenus(userId: number): Promise<MenuModule[]> {
  const [visible, modules, privileges] = await Promise.all([
    repository.listVisibleInterfaces(userId),
    repository.listModulesWithInterfaceIds(),
    getUserPrivileges(userId),
  ])

  const toMenuInterface = (i: { id: number; description: string; i18nKey: string }): MenuInterface => ({
    id: i.id,
    description: i.description,
    i18nKey: i.i18nKey,
    privileges: [...(privileges.get(i.i18nKey) ?? [])],
  })

  const visibleById = new Map(visible.map((i) => [i.id, i]))
  const placed = new Set<number>()
  const tree: MenuModule[] = []

  for (const module of modules) {
    const interfaces = module.interfaceIds
      .filter((id) => visibleById.has(id))
      .map((id) => toMenuInterface(visibleById.get(id)!))
    if (interfaces.length === 0) continue

    module.interfaceIds.forEach((id) => placed.add(id))
    tree.push({
      id: module.id,
      description: module.description,
      i18nKey: module.i18nKey,
      imageIcon: module.imageIcon,
      interfaces,
    })
  }

  // Pseudo-modules: visible screens not linked to any module, grouped by
  // group_default (same fallback setes applies to uncontracted grouping).
  const byGroup = new Map<string, MenuInterface[]>()
  for (const i of visible) {
    if (placed.has(i.id)) continue
    let group = byGroup.get(i.groupDefault)
    if (!group) {
      group = []
      byGroup.set(i.groupDefault, group)
    }
    group.push(toMenuInterface(i))
  }
  for (const [groupDefault, interfaces] of byGroup) {
    tree.push({
      id: null,
      description: groupDefault,
      i18nKey: null,
      imageIcon: null,
      interfaces,
    })
  }

  return tree
}

/** Every grant the user holds, keyed by interface — INCLUDING kind 'R'
 *  resources, which never appear on the menu tree (decision 93). Feeds the
 *  app's SessionAccess. */
export async function getPermissions(userId: number): Promise<Record<string, string[]>> {
  const privileges = await getUserPrivileges(userId)
  const result: Record<string, string[]> = {}
  for (const [interfaceKey, names] of privileges) {
    result[interfaceKey] = [...names]
  }
  return result
}

/** Team users only — mobile identities have no tb_user row (decision 71's
 *  scope note: app roles stay outside the privilege system). */
export async function getMe(userId: number): Promise<MeRow> {
  const me = await repository.findMe(userId)
  if (!me) {
    throw new HttpError(404, 'User not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return me
}

export async function savePreferences(userId: number, locale: string): Promise<MeRow> {
  await getMe(userId)
  await repository.updateLocale(userId, locale)
  return getMe(userId)
}
