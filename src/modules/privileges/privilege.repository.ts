import pool from '@shared/db/connection'
import { PrivilegeRow } from '@modules/privileges/privilege.interface'

export async function listPrivileges(filter?: string): Promise<PrivilegeRow[]> {
  const where = filter ? `AND description LIKE ?` : ''
  const [rows] = await pool.query<any[]>(
    `SELECT id, description FROM tb_privilege WHERE deleted = 'N' ${where} ORDER BY id`,
    filter ? [`%${filter}%`] : []
  )
  return rows
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
