import pool from '@shared/db/connection'
import { SystemModuleRow } from '@modules/system-modules/system-module.interface'

function toRow(row: any): SystemModuleRow {
  return {
    id: row.id,
    description: row.description,
    i18nKey: row.i18nKey ?? null,
    imageIcon: row.imageIcon ?? null,
    position: row.position,
    interfaceIds: row.interfaceIds ? String(row.interfaceIds).split(',').map(Number) : [],
  }
}

const BASE_SELECT = `
  SELECT m.id, m.description, m.i18n_key AS i18nKey, m.image_icon AS imageIcon, m.position,
         (SELECT GROUP_CONCAT(mhi.tb_interface_id ORDER BY mhi.position, mhi.tb_interface_id)
          FROM tb_module_has_interface mhi
          WHERE mhi.tb_module_id = m.id AND mhi.deleted = 'N' AND mhi.active = 'S') AS interfaceIds
  FROM tb_module m`

export async function listSystemModules(filter?: string): Promise<SystemModuleRow[]> {
  const where = filter ? `AND m.description LIKE ?` : ''
  const [rows] = await pool.query<any[]>(
    `${BASE_SELECT} WHERE m.deleted = 'N' ${where} ORDER BY m.position, m.id`,
    filter ? [`%${filter}%`] : []
  )
  return rows.map(toRow)
}

export async function findSystemModuleById(id: number): Promise<SystemModuleRow | null> {
  const [rows] = await pool.query<any[]>(`${BASE_SELECT} WHERE m.id = ? AND m.deleted = 'N'`, [id])
  return rows[0] ? toRow(rows[0]) : null
}

export async function insertSystemModule(input: {
  description: string
  i18nKey: string | null
  imageIcon: string | null
  position: number
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_module (description, i18n_key, image_icon, position) VALUES (?, ?, ?, ?)`,
    [input.description, input.i18nKey, input.imageIcon, input.position]
  )
  return result.insertId
}

export async function updateSystemModule(
  id: number,
  input: { description: string; i18nKey: string | null; imageIcon: string | null; position: number }
): Promise<void> {
  await pool.query(
    `UPDATE tb_module SET description = ?, i18n_key = ?, image_icon = ?, position = ? WHERE id = ?`,
    [input.description, input.i18nKey, input.imageIcon, input.position, id]
  )
}

export async function softDeleteSystemModule(id: number): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`UPDATE tb_module_has_interface SET deleted = 'S' WHERE tb_module_id = ?`, [id])
    await conn.query(`UPDATE tb_module SET deleted = 'S' WHERE id = ?`, [id])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** Links the listed screens in array order and soft-unlinks the rest. */
export async function syncModuleInterfaces(id: number, interfaceIds: number[]): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`UPDATE tb_module_has_interface SET deleted = 'S' WHERE tb_module_id = ?`, [id])
    for (let index = 0; index < interfaceIds.length; index++) {
      await conn.query(
        `INSERT INTO tb_module_has_interface (tb_module_id, tb_interface_id, position)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE deleted = 'N', active = 'S', position = VALUES(position)`,
        [id, interfaceIds[index], index]
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

export async function interfacesExist(interfaceIds: number[]): Promise<boolean> {
  if (interfaceIds.length === 0) return true
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS found FROM tb_interface WHERE id IN (?) AND deleted = 'N'`,
    [interfaceIds]
  )
  return (rows[0]?.found ?? 0) === new Set(interfaceIds).size
}
