import * as repository from '@modules/interfaces/interface.repository'
import { InterfaceInput, InterfaceRow } from '@modules/interfaces/interface.interface'
import { invalidateAllPrivileges } from '@shared/acl/privilege-store'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { PagedQuery, PagedResult, pagedOrPlain } from '@shared/http/paged-query'

/** Plain array without `page`, `{ items, page, pageSize, total }` with it
 *  (PS0, decision 220). */
export async function listInterfaces(
  query: PagedQuery
): Promise<InterfaceRow[] | PagedResult<InterfaceRow>> {
  return pagedOrPlain(
    query,
    (window) => repository.listInterfaces(query.filter, window),
    () => repository.countInterfaces(query.filter)
  )
}

export async function getInterface(id: number): Promise<InterfaceRow> {
  const row = await repository.findInterfaceById(id)
  if (!row) {
    throw new HttpError(404, 'Interface not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return row
}

export async function createInterface(input: InterfaceInput): Promise<InterfaceRow> {
  const clash = await repository.findInterfaceByKey(input.i18nKey)
  if (clash) {
    throw new HttpError(409, 'Interface key already exists', undefined, ErrorCodes.DUPLICATE)
  }
  const id = await repository.insertInterface(input)
  await repository.syncInterfacePrivileges(id, input.privilegeIds)
  return getInterface(id)
}

export async function updateInterface(id: number, input: InterfaceInput): Promise<InterfaceRow> {
  await getInterface(id)
  const clash = await repository.findInterfaceByKey(input.i18nKey)
  if (clash && clash.id !== id) {
    throw new HttpError(409, 'Interface key already exists', undefined, ErrorCodes.DUPLICATE)
  }
  await repository.updateInterface(id, input)
  await repository.syncInterfacePrivileges(id, input.privilegeIds)
  // Key rename or privilege-catalog change affects cached user ACLs and menus.
  invalidateAllPrivileges()
  return getInterface(id)
}

export async function deleteInterface(id: number): Promise<void> {
  await getInterface(id)
  const grants = await repository.countInterfaceGrants(id)
  if (grants > 0) {
    throw new HttpError(
      409,
      'Interface has user privilege grants — revoke them first',
      undefined,
      ErrorCodes.IN_USE
    )
  }
  await repository.softDeleteInterface(id)
  invalidateAllPrivileges()
}
