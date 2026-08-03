import bcrypt from 'bcryptjs'
import * as repository from '@modules/users/user.repository'
import { UserCreateInput, UserUpdateInput } from '@modules/users/user.dto'
import { UserInterfacePrivileges, UserRow } from '@modules/users/user.interface'
import { invalidateUserPrivileges } from '@shared/acl/privilege-store'
import { invalidateSession } from '@shared/acl/session-store'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'

export async function listUsers(filter?: string): Promise<UserRow[]> {
  return repository.listUsers(filter)
}

export async function getUser(id: number): Promise<UserRow> {
  const row = await repository.findUserById(id)
  if (!row) {
    throw new HttpError(404, 'User not found', undefined, ErrorCodes.NOT_FOUND)
  }
  return row
}

export async function createUser(input: UserCreateInput): Promise<UserRow> {
  const clash = await repository.findUserByEmail(input.email)
  if (clash) {
    throw new HttpError(409, 'Email already in use', undefined, ErrorCodes.DUPLICATE)
  }
  const passwordHash = await bcrypt.hash(input.password, 10)
  const id = await repository.insertUser({
    name: input.name,
    email: input.email,
    active: input.active,
    locale: input.locale,
    passwordHash,
  })
  return getUser(id)
}

export async function updateUser(id: number, input: UserUpdateInput): Promise<UserRow> {
  const before = await getUser(id)
  const clash = await repository.findUserByEmail(input.email)
  if (clash && clash.id !== id) {
    throw new HttpError(409, 'Email already in use', undefined, ErrorCodes.DUPLICATE)
  }
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined
  await repository.updateUser(
    id,
    { name: input.name, email: input.email, active: input.active, locale: input.locale },
    passwordHash
  )
  // Session revocation (decision 112): a password set by the admin or a
  // deactivation kills every outstanding session of the target in <=60s.
  if (passwordHash || (before.active === 'S' && input.active === 'N')) {
    await repository.bumpSessionVersion(id)
    invalidateSession(id)
  }
  return getUser(id)
}

export async function deleteUser(id: number, actorId: number): Promise<void> {
  // Lockout guard: with no super user to fall back on (decision 70),
  // deleting your own account could leave the installation without anyone
  // able to manage access.
  if (id === actorId) {
    throw new HttpError(409, 'You cannot delete your own account', undefined, ErrorCodes.SELF_LOCKOUT)
  }
  await getUser(id)
  await repository.softDeleteUser(id)
  await repository.bumpSessionVersion(id)
  invalidateUserPrivileges(id)
  invalidateSession(id)
}

export async function getUserPrivilegeMatrix(id: number): Promise<UserInterfacePrivileges[]> {
  await getUser(id)
  const rows = await repository.listUserPrivilegeMatrix(id)

  const byInterface = new Map<number, UserInterfacePrivileges>()
  for (const row of rows) {
    let entry = byInterface.get(row.interfaceId)
    if (!entry) {
      entry = {
        interfaceId: row.interfaceId,
        interfaceKey: row.interfaceKey,
        description: row.description,
        groupDefault: row.groupDefault,
        privileges: [],
      }
      byInterface.set(row.interfaceId, entry)
    }
    entry.privileges.push({
      privilegeId: row.privilegeId,
      description: row.privilegeDescription,
      granted: row.granted === 1,
    })
  }
  return [...byInterface.values()]
}

export async function syncUserPrivileges(
  userId: number,
  interfaceId: number,
  privilegeIds: number[],
  actorId: number
): Promise<void> {
  await getUser(userId)

  const interfaceKey = await repository.findInterfaceKey(interfaceId)
  if (!interfaceKey) {
    throw new HttpError(404, 'Interface not found', undefined, ErrorCodes.NOT_FOUND)
  }

  const catalog = await repository.listInterfaceCatalogPrivileges(interfaceId)
  const catalogIds = new Set(catalog.map((p) => p.id))
  for (const privilegeId of privilegeIds) {
    if (!catalogIds.has(privilegeId)) {
      throw new HttpError(
        422,
        'Privilege is not cataloged for this interface',
        undefined,
        ErrorCodes.BUSINESS_RULE
      )
    }
  }

  // Business rule inherited from setes (kept by NAME, never by magic id):
  // granting any privilege on a screen implies VIEW — whoever can act on a
  // screen must be able to see it on the menu.
  const view = catalog.find((p) => p.description === Privileges.VIEW)
  const effective = new Set(privilegeIds)
  if (effective.size > 0 && view) {
    effective.add(view.id)
  }

  // Lockout guard, companion to deleteUser's: the Admin cannot revoke their
  // own access to the Users screen, nor their own granting power (the
  // user_privileges 'R' resource — decision 93): either would leave the
  // installation without anyone able to manage access.
  const lockoutKeys: string[] = [InterfaceKeys.USERS, InterfaceKeys.USER_PRIVILEGES]
  if (userId === actorId && lockoutKeys.includes(interfaceKey) && effective.size === 0) {
    throw new HttpError(
      409,
      'You cannot revoke your own access to the Users screen',
      undefined,
      ErrorCodes.SELF_LOCKOUT
    )
  }

  await repository.syncUserInterfacePrivileges(userId, interfaceId, [...effective])
  invalidateUserPrivileges(userId)
}
