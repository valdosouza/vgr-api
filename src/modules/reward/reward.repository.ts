import pool from '@shared/db/connection'
import {
  ContestRow,
  CriteriaRow,
  MediationEvent,
  MediationOutcome,
  ResolutionRow,
  RewardOfferRow,
  RewardOfferStatus,
  RewardRecipientRow,
} from '@modules/reward/reward.interface'

function toOffer(row: any): RewardOfferRow {
  return {
    id: row.id,
    reportId: row.reportId,
    amountCents: row.amountCents,
    guaranteeMode: row.guaranteeMode,
    status: row.status,
    railChargeId: row.railChargeId ?? null,
    noReturnNoticeVersion: row.noReturnNoticeVersion,
    criteriaVersion: row.criteriaVersion,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }
}

const OFFER_SELECT = `
  SELECT id, tb_report_id AS reportId, amount_cents AS amountCents,
         guarantee_mode AS guaranteeMode, status, rail_charge_id AS railChargeId,
         no_return_notice_version AS noReturnNoticeVersion,
         criteria_version AS criteriaVersion,
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
 *  offer's transition to 'reserved'. Decision 150: the criteria version
 *  active at this moment is stamped here and never changes. */
export async function markReserved(
  offerId: number,
  railChargeId: string,
  noReturnNoticeVersion: string,
  criteriaVersion: string,
  recipients: Array<{ helpOfferId: number; amountCents: number }>
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `UPDATE tb_reward_offer
       SET guarantee_mode = 'reserved', status = 'reserved',
           rail_charge_id = ?, no_return_notice_version = ?, criteria_version = ?
       WHERE id = ?`,
      [railChargeId, noReturnNoticeVersion, criteriaVersion, offerId]
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

// --- Mediation discipline (decisions 98/148/149/150) ---

function toCriteria(row: any): CriteriaRow {
  return {
    id: row.id,
    version: row.version,
    body: row.body,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  }
}

/** Decision 150: publishing is append-only — a version is never edited. */
export async function insertCriteria(
  version: string,
  body: string,
  publishedBy: number
): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_mediation_criteria (version, body, published_by) VALUES (?, ?, ?)`,
    [version, body, publishedBy]
  )
  return result.insertId
}

export async function findActiveCriteria(): Promise<CriteriaRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, version, body, published_by AS publishedBy, published_at AS publishedAt
     FROM tb_mediation_criteria ORDER BY id DESC LIMIT 1`
  )
  return rows[0] ? toCriteria(rows[0]) : null
}

export async function findCriteriaByVersion(version: string): Promise<CriteriaRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, version, body, published_by AS publishedBy, published_at AS publishedAt
     FROM tb_mediation_criteria WHERE version = ?`,
    [version]
  )
  return rows[0] ? toCriteria(rows[0]) : null
}

function toResolution(row: any): ResolutionRow {
  return {
    id: row.id,
    rewardOfferId: row.rewardOfferId,
    outcome: row.outcome,
    reason: row.reason,
    criteriaVersion: row.criteriaVersion,
    proposedBy: row.proposedBy,
    proposedAt: row.proposedAt,
    approvedBy: row.approvedBy ?? null,
    approvedAt: row.approvedAt ?? null,
    windowEndsAt: row.windowEndsAt ?? null,
    executedAt: row.executedAt ?? null,
    status: row.status,
  }
}

const RESOLUTION_SELECT = `
  SELECT id, tb_reward_offer_id AS rewardOfferId, outcome, reason,
         criteria_version AS criteriaVersion, proposed_by AS proposedBy,
         proposed_at AS proposedAt, approved_by AS approvedBy,
         approved_at AS approvedAt, window_ends_at AS windowEndsAt,
         executed_at AS executedAt, status
  FROM tb_reward_resolution`

export async function findResolutionById(resolutionId: number): Promise<ResolutionRow | null> {
  const [rows] = await pool.query<any[]>(`${RESOLUTION_SELECT} WHERE id = ?`, [resolutionId])
  return rows[0] ? toResolution(rows[0]) : null
}

/** The at-most-one live (proposed/approved) resolution per offer. */
export async function findLiveResolution(offerId: number): Promise<ResolutionRow | null> {
  const [rows] = await pool.query<any[]>(
    `${RESOLUTION_SELECT} WHERE tb_reward_offer_id = ? AND status IN ('proposed', 'approved')`,
    [offerId]
  )
  return rows[0] ? toResolution(rows[0]) : null
}

export async function insertResolution(
  offerId: number,
  outcome: MediationOutcome,
  reason: string,
  criteriaVersion: string,
  proposedBy: number
): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_reward_resolution
       (tb_reward_offer_id, outcome, reason, criteria_version, proposed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [offerId, outcome, reason, criteriaVersion, proposedBy]
  )
  return result.insertId
}

export async function approveResolution(
  resolutionId: number,
  approvedBy: number,
  windowEndsAt: Date
): Promise<void> {
  await pool.query(
    `UPDATE tb_reward_resolution
     SET status = 'approved', approved_by = ?, approved_at = NOW(), window_ends_at = ?
     WHERE id = ?`,
    [approvedBy, windowEndsAt, resolutionId]
  )
}

export async function cancelResolution(resolutionId: number): Promise<void> {
  await pool.query(`UPDATE tb_reward_resolution SET status = 'cancelled' WHERE id = ?`, [
    resolutionId,
  ])
}

export async function markResolutionExecuted(resolutionId: number): Promise<void> {
  await pool.query(
    `UPDATE tb_reward_resolution SET status = 'executed', executed_at = NOW() WHERE id = ?`,
    [resolutionId]
  )
}

/** Decision 149: who may contest — the payer (reporter) and the helpers of
 *  the recipient set fixed at reserve time (decision 147). */
export async function findPartyAccountIds(offerId: number): Promise<number[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT r.reporter_account_id AS accountId
     FROM tb_reward_offer o JOIN tb_report r ON r.id = o.tb_report_id
     WHERE o.id = ? AND r.reporter_account_id IS NOT NULL
     UNION
     SELECT h.helper_account_id AS accountId
     FROM tb_reward_recipient rec JOIN tb_help_offer h ON h.id = rec.tb_help_offer_id
     WHERE rec.tb_reward_offer_id = ? AND h.helper_account_id IS NOT NULL`,
    [offerId, offerId]
  )
  return rows.map((row) => row.accountId)
}

export async function insertContest(
  resolutionId: number,
  accountId: number,
  body: string
): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_reward_contest (tb_reward_resolution_id, tb_user_account_id, body)
     VALUES (?, ?, ?)`,
    [resolutionId, accountId, body]
  )
  return result.insertId
}

const CONTEST_SELECT = `
  SELECT id, tb_reward_resolution_id AS resolutionId, tb_user_account_id AS accountId,
         body, status, closed_by AS closedBy, closed_note AS closedNote,
         created_at AS createdAt, closed_at AS closedAt
  FROM tb_reward_contest`

export async function findContestById(contestId: number): Promise<ContestRow | null> {
  const [rows] = await pool.query<any[]>(`${CONTEST_SELECT} WHERE id = ?`, [contestId])
  return rows[0] ?? null
}

export async function findOpenContests(resolutionId: number): Promise<ContestRow[]> {
  const [rows] = await pool.query<any[]>(
    `${CONTEST_SELECT} WHERE tb_reward_resolution_id = ? AND status = 'open'`,
    [resolutionId]
  )
  return rows
}

export async function closeContest(
  contestId: number,
  closedBy: number,
  note: string
): Promise<void> {
  await pool.query(
    `UPDATE tb_reward_contest
     SET status = 'closed', closed_by = ?, closed_note = ?, closed_at = NOW()
     WHERE id = ?`,
    [closedBy, note, contestId]
  )
}

/** Append-only (decisions 98/76) — there is deliberately no update or
 *  delete for this table anywhere in the codebase. */
export async function appendMediationLog(
  offerId: number,
  event: MediationEvent,
  actorRef: string,
  details: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_reward_mediation_log (tb_reward_offer_id, event_type, actor_ref, details)
     VALUES (?, ?, ?, ?)`,
    [offerId, event, actorRef, details]
  )
}

export async function findMediationLog(
  offerId: number
): Promise<Array<{ event: MediationEvent; actorRef: string; details: string | null; createdAt: Date }>> {
  const [rows] = await pool.query<any[]>(
    `SELECT event_type AS event, actor_ref AS actorRef, details, created_at AS createdAt
     FROM tb_reward_mediation_log WHERE tb_reward_offer_id = ? ORDER BY id`,
    [offerId]
  )
  return rows
}
