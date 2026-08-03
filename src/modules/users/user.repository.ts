import pool from '@shared/db/connection'
import { UserRow } from '@modules/users/user.interface'

const BASE_SELECT = `
  SELECT id, name, email, active, locale, last_login_at AS lastLoginAt
  FROM tb_user`

export async function listUsers(filter?: string): Promise<UserRow[]> {
  const where = filter ? `AND (name LIKE ? OR email LIKE ?)` : ''
  const [rows] = await pool.query<any[]>(
    `${BASE_SELECT} WHERE deleted = 'N' ${where} ORDER BY name, id`,
    filter ? [`%${filter}%`, `%${filter}%`] : []
  )
  return rows
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const [rows] = await pool.query<any[]>(`${BASE_SELECT} WHERE id = ? AND deleted = 'N'`, [id])
  return rows[0] ?? null
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await pool.query<any[]>(`${BASE_SELECT} WHERE email = ? AND deleted = 'N'`, [email])
  return rows[0] ?? null
}

export async function insertUser(input: {
  name: string
  email: string
  active: string
  locale: string | null
  passwordHash: string
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_user (name, email, active, locale, password_hash) VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.email, input.active, input.locale, input.passwordHash]
  )
  return result.insertId
}

export async function updateUser(
  id: number,
  input: { name: string; email: string; active: string; locale: string | null },
  passwordHash?: string
): Promise<void> {
  if (passwordHash) {
    await pool.query(
      `UPDATE tb_user SET name = ?, email = ?, active = ?, locale = ?, password_hash = ? WHERE id = ?`,
      [input.name, input.email, input.active, input.locale, passwordHash, id]
    )
  } else {
    await pool.query(`UPDATE tb_user SET name = ?, email = ?, active = ?, locale = ? WHERE id = ?`, [
      input.name,
      input.email,
      input.active,
      input.locale,
      id,
    ])
  }
}

export async function softDeleteUser(id: number): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`UPDATE tb_user_has_privilege SET deleted = 'S' WHERE tb_user_id = ?`, [id])
    await conn.query(`UPDATE tb_user SET deleted = 'S', active = 'N' WHERE id = ?`, [id])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** Full matrix: every cataloged screen x its privileges x granted flag. */
export async function listUserPrivilegeMatrix(userId: number): Promise<any[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT i.id AS interfaceId, i.i18n_key AS interfaceKey, i.description,
            i.group_default AS groupDefault,
            p.id AS privilegeId, p.description AS privilegeDescription,
            CASE WHEN up.tb_user_id IS NULL THEN 0 ELSE 1 END AS granted
     FROM tb_interface i
     JOIN tb_interface_has_privilege ihp
       ON ihp.tb_interface_id = i.id AND ihp.deleted = 'N' AND ihp.active = 'S'
     JOIN tb_privilege p ON p.id = ihp.tb_privilege_id AND p.deleted = 'N'
     LEFT JOIN tb_user_has_privilege up
       ON up.tb_user_id = ? AND up.tb_interface_id = i.id AND up.tb_privilege_id = p.id
      AND up.deleted = 'N' AND up.active = 'S'
     WHERE i.deleted = 'N'
     ORDER BY i.group_default, i.position, i.id, p.id`,
    [userId]
  )
  return rows
}

/** Grants the listed privileges on one screen and soft-revokes the rest. */
export async function syncUserInterfacePrivileges(
  userId: number,
  interfaceId: number,
  privilegeIds: number[]
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_user_has_privilege SET deleted = 'S'
       WHERE tb_user_id = ? AND tb_interface_id = ?`,
      [userId, interfaceId]
    )
    for (const privilegeId of privilegeIds) {
      await conn.query(
        `INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE deleted = 'N', active = 'S'`,
        [userId, interfaceId, privilegeId]
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

/** Privileges cataloged for a screen (validates a grant request against it). */
export async function listInterfaceCatalogPrivileges(
  interfaceId: number
): Promise<{ id: number; description: string }[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT p.id, p.description
     FROM tb_interface_has_privilege ihp
     JOIN tb_privilege p ON p.id = ihp.tb_privilege_id AND p.deleted = 'N'
     WHERE ihp.tb_interface_id = ? AND ihp.deleted = 'N' AND ihp.active = 'S'`,
    [interfaceId]
  )
  return rows
}

export async function findInterfaceKey(interfaceId: number): Promise<string | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT i18n_key AS i18nKey FROM tb_interface WHERE id = ? AND deleted = 'N'`,
    [interfaceId]
  )
  return rows[0]?.i18nKey ?? null
}
