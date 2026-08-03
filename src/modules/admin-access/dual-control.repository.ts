import pool from '@shared/db/connection'
import { DualControlAccessRequestRow, DualControlStatus } from '@modules/admin-access/dual-control.interface'

function toRow(row: any): DualControlAccessRequestRow {
  return {
    id: row.id,
    accountabilityLogEntryId: row.accountabilityLogEntryId,
    legalBasis: row.legalBasis,
    approverIds: JSON.parse(row.approverIds),
    status: row.status,
    createdAt: row.createdAt,
  }
}

export async function createRequest(
  accountabilityLogEntryId: number,
  legalBasis: string
): Promise<DualControlAccessRequestRow> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_dual_control_access_request (accountability_log_entry_id, legal_basis, approver_ids, status)
     VALUES (?, ?, ?, 'pending')`,
    [accountabilityLogEntryId, legalBasis, JSON.stringify([])]
  )
  return {
    id: result.insertId,
    accountabilityLogEntryId,
    legalBasis,
    approverIds: [],
    status: 'pending',
    createdAt: new Date(),
  }
}

export async function findAllRequests(): Promise<DualControlAccessRequestRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, accountability_log_entry_id AS accountabilityLogEntryId, legal_basis AS legalBasis,
            approver_ids AS approverIds, status, created_at AS createdAt
     FROM tb_dual_control_access_request ORDER BY created_at DESC`
  )
  return rows.map(toRow)
}

export async function findRequestById(id: number): Promise<DualControlAccessRequestRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, accountability_log_entry_id AS accountabilityLogEntryId, legal_basis AS legalBasis,
            approver_ids AS approverIds, status, created_at AS createdAt
     FROM tb_dual_control_access_request WHERE id = ?`,
    [id]
  )
  return rows[0] ? toRow(rows[0]) : null
}

export async function persistApproval(
  id: number,
  approverIds: string[],
  status: DualControlStatus
): Promise<void> {
  await pool.query(`UPDATE tb_dual_control_access_request SET approver_ids = ?, status = ? WHERE id = ?`, [
    JSON.stringify(approverIds),
    status,
    id,
  ])
}
