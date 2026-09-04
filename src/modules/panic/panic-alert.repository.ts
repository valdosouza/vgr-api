import pool from '@shared/db/connection'
import {
  PanicAlertRow,
  PanicAlertStatus,
  ResponderAlertRow,
} from '@modules/panic/panic-alert.interface'

/**
 * Persistence of the PanicAlert aggregate (migration 046). SQL over
 * tb_panic_alert / tb_panic_alert_recipient — no other module's table is
 * touched here (tb_responder_pool_membership stays behind
 * responder-pool.repository; the service composes both by import within
 * the same `panic` module folder).
 */

const ALERT_SELECT = `
  SELECT id, client_key AS clientKey, account_id AS accountId, lat, lng,
         status, created_at AS createdAt, resolved_at AS resolvedAt
  FROM tb_panic_alert`

function toAlert(row: any): PanicAlertRow {
  return {
    id: row.id,
    clientKey: row.clientKey,
    accountId: row.accountId ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    status: row.status as PanicAlertStatus,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}

/** Idempotency lookup (137): a replay of the same clientKey answers the
 *  SAME alert, first-accept or not. */
export async function findAlertByClientKey(clientKey: string): Promise<PanicAlertRow | null> {
  const [rows] = await pool.query<any[]>(`${ALERT_SELECT} WHERE client_key = ?`, [clientKey])
  return rows[0] ? toAlert(rows[0]) : null
}

/** Cooldown lookup (198) — ONLY meaningful for an identified caller: an
 *  anonymous trigger has no stable account to look up across requests. */
export async function findActiveAlertByAccount(accountId: number): Promise<PanicAlertRow | null> {
  const [rows] = await pool.query<any[]>(
    `${ALERT_SELECT} WHERE account_id = ? AND status = 'active' LIMIT 1`,
    [accountId]
  )
  return rows[0] ? toAlert(rows[0]) : null
}

export async function findAlertById(id: number): Promise<PanicAlertRow | null> {
  const [rows] = await pool.query<any[]>(`${ALERT_SELECT} WHERE id = ?`, [id])
  return rows[0] ? toAlert(rows[0]) : null
}

/** Insert then read back — the same pattern insertMessage/insertRating
 *  use to hand the caller a fully-typed row including created_at. */
export async function insertAlert(input: {
  clientKey: string
  accountId: number | null
  lat: number
  lng: number
}): Promise<PanicAlertRow> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_panic_alert (client_key, account_id, lat, lng, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [input.clientKey, input.accountId, input.lat, input.lng]
  )
  const [rows] = await pool.query<any[]>(`${ALERT_SELECT} WHERE id = ?`, [result.insertId])
  return toAlert(rows[0])
}

/**
 * Snapshot the pool AT TRIGGER TIME (decision 65's "never blocked waiting
 * on configuration" plus the plan's success criterion 2): an EMPTY list
 * is a valid, expected input — the caller decides whether to call this at
 * all, this function just accepts whatever it is handed, including zero
 * rows, without complaint.
 */
export async function insertRecipients(alertId: number, responderAccountIds: number[]): Promise<void> {
  if (responderAccountIds.length === 0) return
  const values = responderAccountIds.map(() => '(?, ?)').join(', ')
  const params = responderAccountIds.flatMap((responderAccountId) => [alertId, responderAccountId])
  await pool.query(
    `INSERT INTO tb_panic_alert_recipient (tb_panic_alert_id, responder_account_id) VALUES ${values}`,
    params
  )
}

export async function countRecipients(alertId: number): Promise<number> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_panic_alert_recipient WHERE tb_panic_alert_id = ?`,
    [alertId]
  )
  return Number(rows[0]?.total ?? 0)
}

/** Atomic active -> resolved (197/198): the WHERE status='active' makes
 *  "cannot resolve twice" a race-free guarantee — 0 affected rows = it
 *  was already resolved (same pattern as reports.repository.markResolved). */
export async function resolveAlert(id: number): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_panic_alert SET status = 'resolved', resolved_at = NOW()
     WHERE id = ? AND status = 'active'`,
    [id]
  )
  return result.affectedRows > 0
}

/**
 * The responder's inbox (192): only alerts where THIS responder is a
 * snapshotted recipient — a membership granted after trigger time never
 * retroactively appears, because this JOIN only ever sees rows the
 * trigger-time snapshot actually wrote. Cursor by alert id ascending
 * (mirrors chat's `id > after`, decision 172's pattern). Resolved alerts
 * are included (marked by `status`) — no separate history endpoint.
 */
export async function findAlertsForResponder(
  responderAccountId: number,
  after: number,
  limit: number
): Promise<ResponderAlertRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT a.id AS alertId, a.lat, a.lng, a.status, a.created_at AS createdAt
     FROM tb_panic_alert_recipient r
     JOIN tb_panic_alert a ON a.id = r.tb_panic_alert_id
     WHERE r.responder_account_id = ? AND a.id > ?
     ORDER BY a.id
     LIMIT ?`,
    [responderAccountId, after, limit]
  )
  return rows.map((row) => ({
    alertId: row.alertId,
    lat: Number(row.lat),
    lng: Number(row.lng),
    status: row.status as PanicAlertStatus,
    createdAt: row.createdAt,
  }))
}
