import pool from '@shared/db/connection'
import {
  AccountProviderRow,
  LoginProvider,
  RefreshTokenRow,
  UserAccountRow,
} from '@modules/accounts/account.interface'

const ACCOUNT_SELECT = `
  SELECT id, display_name AS displayName, email, email_verified AS emailVerified,
         phone, phone_verified AS phoneVerified, password_hash AS passwordHash,
         jurisdiction, consent_version AS consentVersion,
         session_version AS sessionVersion, failed_login_count AS failedLoginCount,
         totp_secret AS totpSecret, totp_enabled AS totpEnabled, active
  FROM tb_user_account`

function toAccount(row: any): UserAccountRow {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email ?? null,
    emailVerified: row.emailVerified === 'S',
    phone: row.phone ?? null,
    phoneVerified: row.phoneVerified === 'S',
    passwordHash: row.passwordHash ?? null,
    jurisdiction: row.jurisdiction,
    consentVersion: row.consentVersion ?? null,
    sessionVersion: row.sessionVersion,
    failedLoginCount: row.failedLoginCount,
    totpSecret: row.totpSecret ?? null,
    totpEnabled: row.totpEnabled === 'S',
    active: row.active === 'S',
  }
}

export async function findAccountById(id: number): Promise<UserAccountRow | null> {
  const [rows] = await pool.query<any[]>(`${ACCOUNT_SELECT} WHERE id = ? AND deleted = 'N'`, [id])
  return rows[0] ? toAccount(rows[0]) : null
}

export async function findAccountByEmail(email: string): Promise<UserAccountRow | null> {
  const [rows] = await pool.query<any[]>(`${ACCOUNT_SELECT} WHERE email = ? AND deleted = 'N'`, [
    email,
  ])
  return rows[0] ? toAccount(rows[0]) : null
}

export async function insertAccount(input: {
  displayName: string
  email: string | null
  passwordHash: string | null
  consentVersion: string
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_user_account (display_name, email, password_hash, consent_version, consent_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [input.displayName, input.email, input.passwordHash, input.consentVersion]
  )
  return result.insertId
}

export async function setPasswordHash(id: number, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE tb_user_account SET password_hash = ?, session_version = session_version + 1
     WHERE id = ?`,
    [passwordHash, id]
  )
}

export async function markEmailVerified(id: number): Promise<void> {
  await pool.query(`UPDATE tb_user_account SET email_verified = 'S' WHERE id = ?`, [id])
}

/** Decision 121: changing the email drops the verified flag on both sides. */
export async function changeEmail(id: number, email: string): Promise<void> {
  await pool.query(
    `UPDATE tb_user_account SET email = ?, email_verified = 'N' WHERE id = ?`,
    [email, id]
  )
}

export async function registerFailedLogin(id: number): Promise<void> {
  await pool.query(
    `UPDATE tb_user_account SET failed_login_count = failed_login_count + 1 WHERE id = ?`,
    [id]
  )
}

export async function clearFailedLogins(id: number): Promise<void> {
  await pool.query(`UPDATE tb_user_account SET failed_login_count = 0 WHERE id = ?`, [id])
}

export async function bumpSessionVersion(id: number): Promise<void> {
  await pool.query(
    `UPDATE tb_user_account SET session_version = session_version + 1 WHERE id = ?`,
    [id]
  )
}

// ------------------------------------------------------------ providers

export async function findProviderIdentity(
  provider: LoginProvider,
  sub: string
): Promise<AccountProviderRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_user_account_id AS accountId, provider, provider_sub AS providerSub,
            email, email_verified AS emailVerified
     FROM tb_user_account_provider
     WHERE provider = ? AND provider_sub = ? AND deleted = 'N'`,
    [provider, sub]
  )
  if (!rows[0]) return null
  return { ...rows[0], emailVerified: rows[0].emailVerified === 'S' }
}

export async function listProvidersOfAccount(accountId: number): Promise<AccountProviderRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_user_account_id AS accountId, provider, provider_sub AS providerSub,
            email, email_verified AS emailVerified
     FROM tb_user_account_provider
     WHERE tb_user_account_id = ? AND deleted = 'N'`,
    [accountId]
  )
  return rows.map((row) => ({ ...row, emailVerified: row.emailVerified === 'S' }))
}

export async function linkProvider(input: {
  accountId: number
  provider: LoginProvider
  providerSub: string
  email: string | null
  emailVerified: boolean
}): Promise<void> {
  await pool.query(
    `INSERT INTO tb_user_account_provider
       (tb_user_account_id, provider, provider_sub, email, email_verified)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE deleted = 'N', email = VALUES(email),
                             email_verified = VALUES(email_verified)`,
    [
      input.accountId,
      input.provider,
      input.providerSub,
      input.email,
      input.emailVerified ? 'S' : 'N',
    ]
  )
}

export async function unlinkProvider(accountId: number, provider: LoginProvider): Promise<void> {
  await pool.query(
    `UPDATE tb_user_account_provider SET deleted = 'S'
     WHERE tb_user_account_id = ? AND provider = ?`,
    [accountId, provider]
  )
}

// ------------------------------------------------------- refresh tokens

export async function insertRefreshToken(input: {
  accountId: number
  familyId: string
  tokenHash: string
  expiresAt: Date
}): Promise<void> {
  await pool.query(
    `INSERT INTO tb_user_refresh_token (tb_user_account_id, family_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [input.accountId, input.familyId, input.tokenHash, input.expiresAt]
  )
}

export async function findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_user_account_id AS accountId, family_id AS familyId,
            expires_at AS expiresAt, used_at AS usedAt, revoked_at AS revokedAt
     FROM tb_user_refresh_token WHERE token_hash = ?`,
    [tokenHash]
  )
  if (!rows[0]) return null
  return {
    ...rows[0],
    expiresAt: new Date(rows[0].expiresAt),
    usedAt: rows[0].usedAt ? new Date(rows[0].usedAt) : null,
    revokedAt: rows[0].revokedAt ? new Date(rows[0].revokedAt) : null,
  }
}

export async function markRefreshTokenUsed(id: number): Promise<void> {
  await pool.query(`UPDATE tb_user_refresh_token SET used_at = NOW() WHERE id = ?`, [id])
}

/** Reuse of a rotated token revokes the whole family (decision 122). */
export async function revokeRefreshFamily(familyId: string): Promise<void> {
  await pool.query(
    `UPDATE tb_user_refresh_token SET revoked_at = NOW()
     WHERE family_id = ? AND revoked_at IS NULL`,
    [familyId]
  )
}

export async function revokeAllRefreshTokens(accountId: number): Promise<void> {
  await pool.query(
    `UPDATE tb_user_refresh_token SET revoked_at = NOW()
     WHERE tb_user_account_id = ? AND revoked_at IS NULL`,
    [accountId]
  )
}
