import pool from '@shared/db/connection'
import { MeRow } from '@modules/core/core.interface'

/** Screens the user can VIEW (menu privilege by NAME — decision 71) that go
 *  to the menu (kind 'T'). */
export async function listVisibleInterfaces(userId: number): Promise<
  { id: number; description: string; i18nKey: string; groupDefault: string; position: number }[]
> {
  const [rows] = await pool.query<any[]>(
    `SELECT i.id, i.description, i.i18n_key AS i18nKey,
            i.group_default AS groupDefault, i.position
     FROM tb_interface i
     JOIN tb_user_has_privilege up
       ON up.tb_interface_id = i.id AND up.tb_user_id = ?
      AND up.active = 'S' AND up.deleted = 'N'
     JOIN tb_privilege p
       ON p.id = up.tb_privilege_id AND p.description = 'VIEW' AND p.deleted = 'N'
     WHERE i.kind = 'T' AND i.deleted = 'N'
     ORDER BY i.position, i.id`,
    [userId]
  )
  return rows
}

/** Admin-managed menu modules with their ordered screen links. */
export async function listModulesWithInterfaceIds(): Promise<
  { id: number; description: string; i18nKey: string | null; imageIcon: string | null; position: number; interfaceIds: number[] }[]
> {
  const [rows] = await pool.query<any[]>(
    `SELECT m.id, m.description, m.i18n_key AS i18nKey, m.image_icon AS imageIcon, m.position,
            (SELECT GROUP_CONCAT(mhi.tb_interface_id ORDER BY mhi.position, mhi.tb_interface_id)
             FROM tb_module_has_interface mhi
             WHERE mhi.tb_module_id = m.id AND mhi.deleted = 'N' AND mhi.active = 'S') AS interfaceIds
     FROM tb_module m
     WHERE m.deleted = 'N'
     ORDER BY m.position, m.id`
  )
  return rows.map((row) => ({
    ...row,
    interfaceIds: row.interfaceIds ? String(row.interfaceIds).split(',').map(Number) : [],
  }))
}

export async function findMe(userId: number): Promise<MeRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, name, email, locale FROM tb_user WHERE id = ? AND deleted = 'N'`,
    [userId]
  )
  return rows[0] ?? null
}

export async function updateLocale(userId: number, locale: string): Promise<void> {
  await pool.query(`UPDATE tb_user SET locale = ? WHERE id = ? AND deleted = 'N'`, [locale, userId])
}
