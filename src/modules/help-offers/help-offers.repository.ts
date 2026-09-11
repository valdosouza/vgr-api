import pool from '@shared/db/connection'
import { HelpOfferRow, HelpType } from '@modules/help-offers/help-offers.interface'
import { splitHelpTypes } from '@shared/help-offer/help-types'

function toOffer(row: any): HelpOfferRow {
  return {
    id: row.id,
    reportId: row.reportId,
    helperAccountId: row.helperAccountId ?? null,
    anonymous: row.anonymous === 'S',
    helpTypes: splitHelpTypes(row.helpTypes),
    createdAt: row.createdAt,
  }
}

/** Offer columns + the aggregated child rows, reused by every reader. */
const OFFER_SELECT = `SELECT o.id, o.tb_report_id AS reportId, o.helper_account_id AS helperAccountId,
            o.anonymous, o.created_at AS createdAt,
            (SELECT GROUP_CONCAT(t.help_type ORDER BY t.help_type)
               FROM tb_help_offer_type t WHERE t.tb_help_offer_id = o.id) AS helpTypes`

/** The guard columns only — read here via SQL, not through the reports
 *  module (no cross-module imports; tables are not module-private). */
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

/** Timeline append for the offer event (decisions 18/19/212): ONE item
 *  carrying the whole set. */
export async function appendHelpOfferedEvent(
  reportId: number,
  helpTypes: HelpType[]
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_report_timeline (tb_report_id, event_type, payload) VALUES (?, 'help_offered', ?)`,
    [reportId, JSON.stringify({ helpTypes })]
  )
}

/** Decision 212: the edit of 211 leaves its own item. */
export async function appendHelpOfferUpdatedEvent(
  reportId: number,
  helpTypes: HelpType[]
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_report_timeline (tb_report_id, event_type, payload) VALUES (?, 'help_offer_updated', ?)`,
    [reportId, JSON.stringify({ helpTypes })]
  )
}

/** Offer + its types in ONE transaction: an offer with zero types is
 *  never observable (208's "at least one"). */
export async function insertHelpOffer(input: {
  reportId: number
  helperAccountId: number | null
  anonymous: boolean
  helpTypes: HelpType[]
}): Promise<number> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<any>(
      `INSERT INTO tb_help_offer (tb_report_id, helper_account_id, anonymous)
       VALUES (?, ?, ?)`,
      [input.reportId, input.helperAccountId, input.anonymous ? 'S' : 'N']
    )
    const helpOfferId: number = result.insertId
    await conn.query(`INSERT INTO tb_help_offer_type (tb_help_offer_id, help_type) VALUES ?`, [
      input.helpTypes.map((type) => [helpOfferId, type]),
    ])
    await conn.commit()
    return helpOfferId
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** Decision 211: the set is REPLACED, atomically — never left empty. */
export async function replaceHelpOfferTypes(
  helpOfferId: number,
  helpTypes: HelpType[]
): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`DELETE FROM tb_help_offer_type WHERE tb_help_offer_id = ?`, [helpOfferId])
    await conn.query(`INSERT INTO tb_help_offer_type (tb_help_offer_id, help_type) VALUES ?`, [
      helpTypes.map((type) => [helpOfferId, type]),
    ])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** The offer plus the guard columns of its report, for the edit path
 *  (211: helper of the offer, report still open). */
export async function findOfferForUpdate(
  helpOfferId: number
): Promise<(HelpOfferRow & { reportStatus: string }) | null> {
  const [rows] = await pool.query<any[]>(
    `${OFFER_SELECT}, r.status AS reportStatus
     FROM tb_help_offer o
     JOIN tb_report r ON r.id = o.tb_report_id AND r.deleted = 'N' AND r.purged = 'N'
     WHERE o.id = ? AND o.deleted = 'N'`,
    [helpOfferId]
  )
  return rows[0] ? { ...toOffer(rows[0]), reportStatus: rows[0].reportStatus } : null
}

export async function findByReportAndHelper(
  reportId: number,
  helperAccountId: number
): Promise<HelpOfferRow | null> {
  const [rows] = await pool.query<any[]>(
    `${OFFER_SELECT}
     FROM tb_help_offer o
     WHERE o.tb_report_id = ? AND o.helper_account_id = ? AND o.deleted = 'N'`,
    [reportId, helperAccountId]
  )
  return rows[0] ? toOffer(rows[0]) : null
}

/** Owner's offer list — display name joined only to be masked per tier
 *  in the service (decisions 6/40/60). */
export async function findByReport(
  reportId: number
): Promise<Array<HelpOfferRow & { helperDisplayName: string | null }>> {
  const [rows] = await pool.query<any[]>(
    `${OFFER_SELECT}, a.display_name AS helperDisplayName
     FROM tb_help_offer o
     LEFT JOIN tb_user_account a ON a.id = o.helper_account_id
     WHERE o.tb_report_id = ? AND o.deleted = 'N'
     ORDER BY o.created_at`,
    [reportId]
  )
  return rows.map((row) => ({ ...toOffer(row), helperDisplayName: row.helperDisplayName ?? null }))
}
