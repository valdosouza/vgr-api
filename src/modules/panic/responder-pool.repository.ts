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

/** Only actively approved members — used by panic-alert routing (task 28).
 *  The JOIN on tb_user_account is deliberate (found by the first manual
 *  end-to-end run, 2026-09-06): a membership whose user_id no longer
 *  matches an app account — stale data from before the plane fix of PP1,
 *  or a test run that leaked into the dev database — must never reach the
 *  alert's recipient snapshot, whose FK would then fail the WHOLE trigger
 *  with a 500. An emergency action is never refused because of operational
 *  garbage (decision 65). Migration 048 adds the FK that makes such rows
 *  impossible from now on; this JOIN keeps the trigger safe regardless. */
export async function findActiveMembers(): Promise<ResponderPoolMembershipRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT m.id, m.user_id AS userId, m.status, m.criteria_notes AS criteriaNotes,
            m.requested_at AS requestedAt, m.resolved_at AS resolvedAt, m.resolved_by AS resolvedBy
     FROM tb_responder_pool_membership m
     JOIN tb_user_account a ON a.id = m.user_id
     WHERE m.status = 'approved'`
  )
  return rows
}
