import pool from '@shared/db/connection'
import { HelpOfferRow, HelpType } from '@modules/help-offers/help-offers.interface'

function toOffer(row: any): HelpOfferRow {
  return {
    id: row.id,
    reportId: row.reportId,
    helperAccountId: row.helperAccountId ?? null,
    anonymous: row.anonymous === 'S',
    helpType: row.helpType,
    createdAt: row.createdAt,
  }
}

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

/** Timeline append for the offer event (decisions 18/19). */
export async function appendHelpOfferedEvent(reportId: number, helpType: HelpType): Promise<void> {
  await pool.query(
    `INSERT INTO tb_report_timeline (tb_report_id, event_type, payload) VALUES (?, 'help_offered', ?)`,
    [reportId, JSON.stringify({ helpType })]
  )
}

export async function insertHelpOffer(input: {
  reportId: number
  helperAccountId: number | null
  anonymous: boolean
  helpType: HelpType
}): Promise<number> {
  const [result] = await pool.query<any>(
    `INSERT INTO tb_help_offer (tb_report_id, helper_account_id, anonymous, help_type)
     VALUES (?, ?, ?, ?)`,
    [input.reportId, input.helperAccountId, input.anonymous ? 'S' : 'N', input.helpType]
  )
  return result.insertId
}

export async function findByReportAndHelper(
  reportId: number,
  helperAccountId: number
): Promise<HelpOfferRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_report_id AS reportId, helper_account_id AS helperAccountId,
            anonymous, help_type AS helpType, created_at AS createdAt
     FROM tb_help_offer
     WHERE tb_report_id = ? AND helper_account_id = ? AND deleted = 'N'`,
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
    `SELECT o.id, o.tb_report_id AS reportId, o.helper_account_id AS helperAccountId,
            o.anonymous, o.help_type AS helpType, o.created_at AS createdAt,
            a.display_name AS helperDisplayName
     FROM tb_help_offer o
     LEFT JOIN tb_user_account a ON a.id = o.helper_account_id
     WHERE o.tb_report_id = ? AND o.deleted = 'N'
     ORDER BY o.created_at`,
    [reportId]
  )
  return rows.map((row) => ({ ...toOffer(row), helperDisplayName: row.helperDisplayName ?? null }))
}
