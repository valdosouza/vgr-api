import pool from '@shared/db/connection'
import { InterfaceRow } from '@modules/interfaces/interface.interface'

function toRow(row: any): InterfaceRow {
  return {
    id: row.id,
    description: row.description,
    i18nKey: row.i18nKey,
    groupDefault: row.groupDefault,
    kind: row.kind,
    position: row.position,
    privilegeIds: row.privilegeIds ? String(row.privilegeIds).split(',').map(Number) : [],
  }
}

const BASE_SELECT = `
  SELECT i.id, i.description, i.i18n_key AS i18nKey, i.group_default AS groupDefault,
         i.kind, i.position,
         (SELECT GROUP_CONCAT(ihp.tb_privilege_id)
          FROM tb_interface_has_privilege ihp
          WHERE ihp.tb_interface_id = i.id AND ihp.deleted = 'N') AS privilegeIds
  FROM tb_interface i`

export async function listInterfaces(filter?: string): Promise<InterfaceRow[]> {
  const where = filter ? `AND (i.description LIKE ? OR i.i18n_key LIKE ?)` : ''
  const [rows] = await pool.query<any[]>(
    `${BASE_SELECT} WHERE i.deleted = 'N' ${where} ORDER BY i.group_default, i.position, i.id`,
    filter ? [`%${filter}%`, `%${filter}%`] : []
  )
  return rows.map(toRow)
}

export async function findInterfaceById(id: number): Promise<InterfaceRow | null> {
  const [rows] = await pool.query<any[]>(`${BASE_SELECT} WHERE i.id = ? AND i.deleted = 'N'`, [id])
  return rows[0] ? toRow(rows[0]) : null
}

export async function findInterfaceByKey(i18nKey: string): Promise<InterfaceRow | null> {
  const [rows] = await pool.query<any[]>(
    `${BASE_SELECT} WHERE i.i18n_key = ? AND i.deleted = 'N'`,
    [i18nKey]
  )
  return rows[0] ? toRow(rows[0]) : null
}

export async function insertInterface(input: {
  description: string
  i18nKey: string
  groupDefault: string
  kind: string
  position: number
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_interface (description, i18n_key, group_default, kind, position)
     VALUES (?, ?, ?, ?, ?)`,
    [input.description, input.i18nKey, input.groupDefault, input.kind, input.position]
  )
  return result.insertId
}

export async function updateInterface(
  id: number,
  input: { description: string; i18nKey: string; groupDefault: string; kind: string; position: number }
): Promise<void> {
  await pool.query(
    `UPDATE tb_interface SET description = ?, i18n_key = ?, group_default = ?, kind = ?, position = ?
     WHERE id = ?`,
    [input.description, input.i18nKey, input.groupDefault, input.kind, input.position, id]
  )
}

export async function softDeleteInterface(id: number): Promise<void> {
  await pool.query(`UPDATE tb_interface SET deleted = 'S' WHERE id = ?`, [id])
}

/** Grants the listed privileges to the screen and soft-revokes the rest, in
 *  one transaction (same sync semantics as setes' PUT). */
export async function syncInterfacePrivileges(id: number, privilegeIds: number[]): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_interface_has_privilege SET deleted = 'S' WHERE tb_interface_id = ?`,
      [id]
    )
    for (const privilegeId of privilegeIds) {
      await conn.query(
        `INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE deleted = 'N', active = 'S'`,
        [id, privilegeId]
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** A screen with user grants cannot be deleted. */
export async function countInterfaceGrants(id: number): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS grants FROM tb_user_has_privilege
     WHERE tb_interface_id = ? AND deleted = 'N'`,
    [id]
  )
  return rows[0]?.grants ?? 0
}
