import pool from '@shared/db/connection'
import { AdminAccountRow } from '@modules/auth/admin-account.interface'

export async function findAdminAccountByEmail(email: string): Promise<AdminAccountRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, email, password_hash AS passwordHash, active
     FROM tb_user WHERE email = ? AND deleted = 'N'`,
    [email]
  )
  return rows[0] ?? null
}

export async function registerLogin(id: number): Promise<void> {
  await pool.query(`UPDATE tb_user SET last_login_at = NOW() WHERE id = ?`, [id])
}

/** Stores the 6-digit recovery code; updated_at marks the start of its window. */
export async function setActivationKey(id: number, code: string): Promise<void> {
  await pool.query(`UPDATE tb_user SET activation_key = ?, updated_at = NOW() WHERE id = ?`, [
    code,
    id,
  ])
}

export async function getActivationInfo(
  id: number
): Promise<{ activationKey: string | null; ageMinutes: number } | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT activation_key AS activationKey,
            TIMESTAMPDIFF(MINUTE, updated_at, NOW()) AS ageMinutes
     FROM tb_user WHERE id = ? AND deleted = 'N'`,
    [id]
  )
  return rows[0] ?? null
}

export async function updatePassword(id: number, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE tb_user SET password_hash = ?, activation_key = NULL WHERE id = ?`,
    [passwordHash, id]
  )
}

/** Used only by scripts/seed-admin.ts — bootstrap of the very first account
 *  (decision 75: day-to-day creation happens on the Users screen). */
export async function upsertAdminAccount(email: string, passwordHash: string): Promise<number> {
  await pool.query(
    `INSERT INTO tb_user (name, email, password_hash) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), active = 'S', deleted = 'N'`,
    [email.split('@')[0], email, passwordHash]
  )
  const [rows] = await pool.query<any[]>(`SELECT id FROM tb_user WHERE email = ?`, [email])
  return rows[0].id
}

/** Bootstrap grant (decision 70): gives the seeded account every cataloged
 *  privilege so the installation always has at least one full Admin. */
export async function grantAllPrivileges(userId: number): Promise<void> {
  await pool.query(
    `INSERT INTO tb_user_has_privilege (tb_user_id, tb_interface_id, tb_privilege_id)
     SELECT ?, ihp.tb_interface_id, ihp.tb_privilege_id
     FROM tb_interface_has_privilege ihp
     WHERE ihp.deleted = 'N' AND ihp.active = 'S'
     ON DUPLICATE KEY UPDATE deleted = 'N', active = 'S'`,
    [userId]
  )
}
