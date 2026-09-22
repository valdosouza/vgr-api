import pool from '@shared/db/connection'
import { PrivilegeRow } from '@modules/privileges/privilege.interface'
import { LIMIT_OFFSET_SQL, PageWindow, limitOffsetArgs } from '@shared/http/paged-query'

/** Filter on the natural text column (PS0, decision 220); parameterized. */
function filterClause(filter?: string): { sql: string; params: string[] } {
  return filter ? { sql: ` AND description LIKE ?`, params: [`%${filter}%`] } : { sql: '', params: [] }
}

/** No window = the legacy unpaged list (decision 220 keeps it intact). */
export async function listPrivileges(filter?: string, window?: PageWindow): Promise<PrivilegeRow[]> {
  const where = filterClause(filter)
  const [rows] = await pool.query<any[]>(
    `SELECT id, description FROM tb_privilege WHERE deleted = 'N'${where.sql} ORDER BY id${
      window ? ` ${LIMIT_OFFSET_SQL}` : ''
    }`,
    window ? [...where.params, ...limitOffsetArgs(window)] : where.params
  )
  return rows
}

export async function countPrivileges(filter?: string): Promise<number> {
  const where = filterClause(filter)
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_privilege WHERE deleted = 'N'${where.sql}`,
    where.params
  )
  return Number(rows[0]?.total ?? 0)
}

export async function findPrivilegeById(id: number): Promise<PrivilegeRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, description FROM tb_privilege WHERE id = ? AND deleted = 'N'`,
    [id]
  )
  return rows[0] ?? null
}

export async function findPrivilegeByDescription(description: string): Promise<PrivilegeRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, description FROM tb_privilege WHERE description = ? AND deleted = 'N'`,
    [description]
  )
  return rows[0] ?? null
}

export async function insertPrivilege(description: string): Promise<number> {
  const [result] = await pool.query<any>(`INSERT INTO tb_privilege (description) VALUES (?)`, [
    description,
  ])
  return result.insertId
}

export async function updatePrivilege(id: number, description: string): Promise<void> {
  await pool.query(`UPDATE tb_privilege SET description = ? WHERE id = ?`, [description, id])
}

export async function softDeletePrivilege(id: number): Promise<void> {
  await pool.query(`UPDATE tb_privilege SET deleted = 'S' WHERE id = ?`, [id])
}

/** A privilege granted to any user (or cataloged on any screen) cannot be deleted. */
export async function countPrivilegeUsages(id: number): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT (SELECT COUNT(*) FROM tb_interface_has_privilege WHERE tb_privilege_id = ? AND deleted = 'N')
          + (SELECT COUNT(*) FROM tb_user_has_privilege WHERE tb_privilege_id = ? AND deleted = 'N') AS usages`,
    [id, id]
  )
  return rows[0]?.usages ?? 0
}
