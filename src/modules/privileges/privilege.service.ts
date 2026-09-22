import * as repository from '@modules/privileges/privilege.repository'
import { PrivilegeRow } from '@modules/privileges/privilege.interface'
import { invalidateAllPrivileges } from '@shared/acl/privilege-store'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import { PagedQuery, PagedResult, pagedOrPlain } from '@shared/http/paged-query'

/** Plain array without `page`, `{ items, page, pageSize, total }` with it
 *  (PS0, decision 220). */
export async function listPrivileges(
  query: PagedQuery
): Promise<PrivilegeRow[] | PagedResult<PrivilegeRow>> {
  return pagedOrPlain(
    query,
    (window) => repository.listPrivileges(query.filter, window),
    () => repository.countPrivileges(query.filter)
  )
}

export async function getPrivilege(id: number): Promise<PrivilegeRow> {
  const row = await repository.findPrivilegeById(id)
  if (!row) {
    throw new HttpError(404, 'Privilege not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return row
}

export async function createPrivilege(description: string): Promise<PrivilegeRow> {
  const existing = await repository.findPrivilegeByDescription(description)
  if (existing) {
    throw new HttpError(409, 'Privilege already exists', undefined, ErrorCodes.DUPLICATE)
  }
  const id = await repository.insertPrivilege(description)
  return { id, description }
}

export async function updatePrivilege(id: number, description: string): Promise<PrivilegeRow> {
  await getPrivilege(id)
  const clash = await repository.findPrivilegeByDescription(description)
  if (clash && clash.id !== id) {
    throw new HttpError(409, 'Privilege already exists', undefined, ErrorCodes.DUPLICATE)
  }
  await repository.updatePrivilege(id, description)
  // Renaming a privilege changes every cached grant that referenced the old name.
  invalidateAllPrivileges()
  return { id, description }
}

export async function deletePrivilege(id: number): Promise<void> {
  await getPrivilege(id)
  const usages = await repository.countPrivilegeUsages(id)
  if (usages > 0) {
    throw new HttpError(
      409,
      'Privilege is in use by interfaces or user grants',
      undefined,
      ErrorCodes.IN_USE
    )
  }
  await repository.softDeletePrivilege(id)
  invalidateAllPrivileges()
}
