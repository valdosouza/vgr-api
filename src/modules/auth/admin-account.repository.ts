import pool from '@shared/db/connection'
import { AdminAccountRow } from '@modules/auth/admin-account.interface'

export async function findAdminAccountByEmail(email: string): Promise<AdminAccountRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, email, password_hash AS passwordHash FROM tb_admin_account WHERE email = ?`,
    [email]
  )
  return rows[0] ?? null
}

/** Used only by scripts/seed-admin.ts — no self-registration endpoint exists (decision 67). */
export async function upsertAdminAccount(email: string, passwordHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO tb_admin_account (email, password_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [email, passwordHash]
  )
}
