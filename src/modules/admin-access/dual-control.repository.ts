import pool from '@shared/db/connection'
import { DualControlAccessRequestRow } from '@modules/admin-access/dual-control.interface'
import { LIMIT_OFFSET_SQL, PageWindow, limitOffsetArgs } from '@shared/http/paged-query'

/** Requester and approver by NAME, never e-mail (decision 227) — the same
 *  join the admin-audit trail uses for its actor. */
const SELECT_REQUEST = `SELECT r.id, r.accountability_log_entry_id AS accountabilityLogEntryId,
       r.legal_basis AS legalBasis, r.status,
       r.requested_by AS requestedBy, ru.name AS requestedByName,
       r.approved_by AS approvedBy, au.name AS approvedByName,
       r.approved_at AS approvedAt, r.created_at AS createdAt
  FROM tb_dual_control_access_request r
  LEFT JOIN tb_user ru ON ru.id = r.requested_by
  LEFT JOIN tb_user au ON au.id = r.approved_by`

function toRow(row: any): DualControlAccessRequestRow {
  return {
    id: row.id,
    accountabilityLogEntryId: row.accountabilityLogEntryId,
    legalBasis: row.legalBasis,
    status: row.status,
    requestedBy: row.requestedBy ?? null,
    requestedByName: row.requestedByName ?? null,
    approvedBy: row.approvedBy ?? null,
    approvedByName: row.approvedByName ?? null,
    approvedAt: row.approvedAt ?? null,
    createdAt: row.createdAt,
  }
}

/** Filter on the legal basis (decision 227); parameterized. */
function filterClause(filter?: string): { sql: string; params: string[] } {
  return filter ? { sql: ` WHERE r.legal_basis LIKE ?`, params: [`%${filter}%`] } : { sql: '', params: [] }
}

/** The log is append-only and never read back for content (identity.md);
 *  this only asks whether the referenced entry exists (decision 226). */
export async function accountabilityEntryExists(id: number): Promise<boolean> {
  const [rows] = await pool.query<any[]>(`SELECT 1 FROM tb_accountability_log WHERE id = ? LIMIT 1`, [id])
  return rows.length > 0
}

export async function createRequest(
  accountabilityLogEntryId: number,
  legalBasis: string,
  requestedBy: number
): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_dual_control_access_request (accountability_log_entry_id, legal_basis, requested_by, status)
     VALUES (?, ?, ?, 'pending')`,
    [accountabilityLogEntryId, legalBasis, requestedBy]
  )
  return result.insertId
}

/** Newest first (decision 227); no window = the unpaged list (220). */
export async function listRequests(filter?: string, window?: PageWindow): Promise<DualControlAccessRequestRow[]> {
  const where = filterClause(filter)
  const [rows] = await pool.query<any[]>(
    `${SELECT_REQUEST}${where.sql} ORDER BY r.created_at DESC, r.id DESC${window ? ` ${LIMIT_OFFSET_SQL}` : ''}`,
    window ? [...where.params, ...limitOffsetArgs(window)] : where.params
  )
  return rows.map(toRow)
}

export async function countRequests(filter?: string): Promise<number> {
  const where = filterClause(filter)
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total FROM tb_dual_control_access_request r${where.sql}`,
    where.params
  )
  return Number(rows[0]?.total ?? 0)
}

export async function findRequestById(id: number): Promise<DualControlAccessRequestRow | null> {
  const [rows] = await pool.query<any[]>(`${SELECT_REQUEST} WHERE r.id = ?`, [id])
  return rows[0] ? toRow(rows[0]) : null
}

/**
 * Conditional write (decision 224): only a still-pending request flips, so
 * two simultaneous approvals never overwrite each other — the loser gets
 * `false`. `chk_dual_control_two_people` (migration 050) refuses a grant by
 * the requester even if the service let one through.
 */
export async function grantRequest(id: number, approvedBy: number): Promise<boolean> {
  const [result] = await pool.query<any>(
    `UPDATE tb_dual_control_access_request
        SET status = 'granted', approved_by = ?, approved_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [approvedBy, id]
  )
  return result.affectedRows === 1
}
