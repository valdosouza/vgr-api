import pool from '@shared/db/connection'
import { RewardOfferRow, RewardOfferStatus, RewardRecipientRow } from '@modules/reward/reward.interface'

function toOffer(row: any): RewardOfferRow {
  return {
    id: row.id,
    reportId: row.reportId,
    amountCents: row.amountCents,
    guaranteeMode: row.guaranteeMode,
    status: row.status,
    railChargeId: row.railChargeId ?? null,
    noReturnNoticeVersion: row.noReturnNoticeVersion,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}

const OFFER_SELECT = `
  SELECT id, tb_report_id AS reportId, amount_cents AS amountCents,
         guarantee_mode AS guaranteeMode, status, rail_charge_id AS railChargeId,
         no_return_notice_version AS noReturnNoticeVersion,
         created_at AS createdAt, resolved_at AS resolvedAt
  FROM tb_reward_offer`

/** The guard columns only — read via SQL, not through the reports module
 *  (no cross-module imports; tables are not module-private). */
export async function findReportForOffer(
  reportId: number
): Promise<{ id: number; reporterAccountId: number | null; status: string } | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, reporter_account_id AS reporterAccountId, status
     FROM tb_report WHERE id = ? AND deleted = 'N' AND purged = 'N'`,
    [reportId]
  )
  return rows[0] ?? null
}

export async function findOfferByReport(reportId: number): Promise<RewardOfferRow | null> {
  const [rows] = await pool.query<any[]>(
    `${OFFER_SELECT} WHERE tb_report_id = ? AND deleted = 'N'`,
    [reportId]
  )
  return rows[0] ? toOffer(rows[0]) : null
}

export async function findOfferById(offerId: number): Promise<RewardOfferRow | null> {
  const [rows] = await pool.query<any[]>(`${OFFER_SELECT} WHERE id = ? AND deleted = 'N'`, [offerId])
  return rows[0] ? toOffer(rows[0]) : null
}

export async function insertOffer(input: { reportId: number; amountCents: number }): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_reward_offer (tb_report_id, amount_cents) VALUES (?, ?)`,
    [input.reportId, input.amountCents]
  )
  return result.insertId
}

/** Belonging check for decision 147: every targeted recipient must be a
 *  real help offer on THIS report. */
export async function findHelpOffersForRecipients(
  reportId: number,
  helpOfferIds: number[]
): Promise<Array<{ id: number; helperAccountId: number | null }>> {
  if (helpOfferIds.length === 0) return []
  const [rows] = await pool.query<any[]>(
    `SELECT id, helper_account_id AS helperAccountId
     FROM tb_help_offer
     WHERE tb_report_id = ? AND id IN (?) AND deleted = 'N'`,
    [reportId, helpOfferIds]
  )
  return rows
}

export async function findRecipientProfile(
  accountId: number
): Promise<{ railRecipientId: string } | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT rail_recipient_id AS railRecipientId
     FROM tb_reward_recipient_profile WHERE tb_user_account_id = ? AND deleted = 'N'`,
    [accountId]
  )
  return rows[0] ?? null
}

/** Stores ONLY the opaque rail id (decision 143) — the KYC data that
 *  produced it lives at the PSP, never in a VGR table. */
export async function insertRecipientProfile(
  accountId: number,
  railRecipientId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_reward_recipient_profile (tb_user_account_id, rail_recipient_id)
     VALUES (?, ?)`,
    [accountId, railRecipientId]
  )
}

/** Decision 147: writes the fixed recipient set once, atomically with the
 *  offer's transition to 'reserved'. */
export async function markReserved(
  offerId: number,
  railChargeId: string,
  noReturnNoticeVersion: string,
  recipients: Array<{ helpOfferId: number; amountCents: number }>
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_reward_offer
       SET guarantee_mode = 'reserved', status = 'reserved',
           rail_charge_id = ?, no_return_notice_version = ?
       WHERE id = ?`,
      [railChargeId, noReturnNoticeVersion, offerId]
    )
    for (const recipient of recipients) {
      await conn.query(
        `INSERT INTO tb_reward_recipient (tb_reward_offer_id, tb_help_offer_id, amount_cents)
         VALUES (?, ?, ?)`,
        [offerId, recipient.helpOfferId, recipient.amountCents]
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

export async function findRecipients(offerId: number): Promise<RewardRecipientRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_reward_offer_id AS rewardOfferId, tb_help_offer_id AS helpOfferId,
            amount_cents AS amountCents, status
     FROM tb_reward_recipient WHERE tb_reward_offer_id = ?`,
    [offerId]
  )
  return rows
}

export async function markResolved(offerId: number, status: 'released' | 'refunded'): Promise<void> {
  await pool.query(`UPDATE tb_reward_offer SET status = ?, resolved_at = NOW() WHERE id = ?`, [
    status,
    offerId,
  ])
  if (status === 'released') {
    await pool.query(`UPDATE tb_reward_recipient SET status = 'paid' WHERE tb_reward_offer_id = ?`, [
      offerId,
    ])
  }
}

/** Decision 85: the seal must derive from the LIVE rail state — used by the
 *  read path to reconcile drift (e.g. an Asaas daysToExpire auto-release)
 *  without waiting for the next mutation. */
export async function updateOfferStatus(offerId: number, status: RewardOfferStatus): Promise<void> {
  await pool.query(`UPDATE tb_reward_offer SET status = ? WHERE id = ?`, [status, offerId])
}
