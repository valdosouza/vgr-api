import pool from '@shared/db/connection'
import { ResponderPoolMembershipRow } from '@modules/panic/responder-pool.interface'

export async function createMembershipRequest(
  userId: number,
  criteriaNotes: string | null
): Promise<ResponderPoolMembershipRow> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_responder_pool_membership (user_id, status, criteria_notes) VALUES (?, 'pending', ?)`,
    [userId, criteriaNotes]
  )
  return {
    id: result.insertId,
    userId,
    status: 'pending',
    criteriaNotes,
    requestedAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
  }
}

export async function findPendingMemberships(): Promise<ResponderPoolMembershipRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, user_id AS userId, status, criteria_notes AS criteriaNotes, requested_at AS requestedAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy
     FROM tb_responder_pool_membership WHERE status = 'pending' ORDER BY requested_at`
  )
  return rows
}

export async function resolveMembership(id: number, approved: boolean, resolvedBy: number): Promise<void> {
  await pool.query(
    `UPDATE tb_responder_pool_membership SET status = ?, resolved_at = NOW(), resolved_by = ? WHERE id = ?`,
    [approved ? 'approved' : 'denied', resolvedBy, id]
  )
}

/** Only actively approved members — used by panic-alert routing (task 28). */
export async function findActiveMembers(): Promise<ResponderPoolMembershipRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, user_id AS userId, status, criteria_notes AS criteriaNotes, requested_at AS requestedAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy
     FROM tb_responder_pool_membership WHERE status = 'approved'`
  )
  return rows
}
