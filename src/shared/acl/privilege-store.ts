import pool from '@shared/db/connection'

/**
 * Per-user privilege lookup with TTL cache — the source of truth for
 * backend enforcement (decision 72: the API is the authority; the app's
 * menu/buttons only reflect it). Same cache philosophy as setes-api's
 * feature-flag middleware: DB is the source of truth, cache keeps the
 * per-request cost near zero, mutations invalidate explicitly.
 *
 * Lives in @shared (not @gateway) because both the gateway middleware and
 * the users/core modules need it, and modules never import gateway code.
 */

const TTL_MS = 60_000

type PrivilegeMap = Map<string, Set<string>>

const cache = new Map<number, { privileges: PrivilegeMap; expiresAt: number }>()

/** interfaceKey → set of privilege names granted to the user. */
export async function getUserPrivileges(userId: number): Promise<PrivilegeMap> {
  const cached = cache.get(userId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.privileges
  }

  const [rows] = await pool.query<any[]>(
    `SELECT i.i18n_key AS interfaceKey, p.description AS privilege
     FROM tb_user_has_privilege up
     JOIN tb_interface i ON i.id = up.tb_interface_id AND i.deleted = 'N'
     JOIN tb_privilege p ON p.id = up.tb_privilege_id AND p.deleted = 'N'
     WHERE up.tb_user_id = ? AND up.active = 'S' AND up.deleted = 'N'`,
    [userId]
  )

  const privileges: PrivilegeMap = new Map()
  for (const row of rows) {
    let set = privileges.get(row.interfaceKey)
    if (!set) {
      set = new Set()
      privileges.set(row.interfaceKey, set)
    }
    set.add(row.privilege)
  }

  cache.set(userId, { privileges, expiresAt: Date.now() + TTL_MS })
  return privileges
}

export async function userHasPrivilege(
  userId: number,
  interfaceKey: string,
  privilege: string
): Promise<boolean> {
  const privileges = await getUserPrivileges(userId)
  return privileges.get(interfaceKey)?.has(privilege) ?? false
}

/** Call after granting/revoking privileges for a user (users module). */
export function invalidateUserPrivileges(userId: number): void {
  cache.delete(userId)
}

/** Call after catalog-wide changes (interface/privilege CRUD). */
export function invalidateAllPrivileges(): void {
  cache.clear()
}
