import pool from '@shared/db/connection'
import {
  HelperRatingAggregateRow,
  HelperRatingRow,
  RatingOfferRow,
  RatingReportRow,
} from '@modules/ratings/helper-rating.interface'

/**
 * Persistence of the HelperRating aggregate (migration 045). SQL over
 * tb_report / tb_help_offer is table access, not a module import — the
 * posture of messaging and help-offers. Append-only (decision 183): there
 * is no update and no delete function here, on purpose.
 */

/** The guard columns of the case (deleted rows are gone; purged ones are
 *  returned so the service answers the same 404 as reports). */
export async function findReportForRating(reportId: number): Promise<RatingReportRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, client_key AS clientKey, reporter_account_id AS reporterAccountId,
            status, hidden, purged
     FROM tb_report WHERE id = ? AND deleted = 'N'`,
    [reportId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    clientKey: row.clientKey,
    reporterAccountId: row.reporterAccountId ?? null,
    status: row.status,
    hidden: row.hidden === 'S',
    purged: row.purged === 'S',
  }
}

/** The offer by id AND report: an offer of another case is simply not
 *  found (existence is information, 55). */
export async function findOfferForRating(
  offerId: number,
  reportId: number
): Promise<RatingOfferRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, tb_report_id AS reportId, helper_account_id AS helperAccountId, anonymous
     FROM tb_help_offer WHERE id = ? AND tb_report_id = ? AND deleted = 'N'`,
    [offerId, reportId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    reportId: row.reportId,
    helperAccountId: row.helperAccountId ?? null,
    anonymous: row.anonymous === 'S',
  }
}

const RATING_SELECT = `
  SELECT id, tb_help_offer_id AS helpOfferId, tb_report_id AS reportId,
         helper_account_id AS helperAccountId, score, client_key AS clientKey,
         created_at AS createdAt
  FROM tb_helper_rating`

function toRating(row: any): HelperRatingRow {
  return {
    id: row.id,
    helpOfferId: row.helpOfferId,
    reportId: row.reportId,
    helperAccountId: row.helperAccountId,
    score: Number(row.score),
    clientKey: row.clientKey,
    createdAt: row.createdAt,
  }
}

/** One rating per offer (183): the living row of an offer, or null. */
export async function findRatingByOffer(offerId: number): Promise<HelperRatingRow | null> {
  const [rows] = await pool.query<any[]>(
    `${RATING_SELECT} WHERE tb_help_offer_id = ? AND deleted = 'N'`,
    [offerId]
  )
  return rows[0] ? toRating(rows[0]) : null
}

/**
 * Append (183: no update, no delete exists). Returns the stored row, or
 * null when a UNIQUE key collided — the offer's (a second rating racing
 * the first) or the clientKey's (an offline-queue replay racing itself,
 * 137); the caller re-reads the winner and decides.
 */
export async function insertRating(input: {
  helpOfferId: number
  reportId: number
  helperAccountId: number
  score: number
  clientKey: string
}): Promise<HelperRatingRow | null> {
  let insertId: number
  try {
    const [result] = await pool.query<any>(
      `INSERT INTO tb_helper_rating
         (tb_help_offer_id, tb_report_id, helper_account_id, score, client_key)
       VALUES (?, ?, ?, ?, ?)`,
      [input.helpOfferId, input.reportId, input.helperAccountId, input.score, input.clientKey]
    )
    insertId = result.insertId
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return null
    throw err
  }
  const [rows] = await pool.query<any[]>(`${RATING_SELECT} WHERE id = ?`, [insertId])
  return rows[0] ? toRating(rows[0]) : null
}

/**
 * The aggregate on the internal identity (spec findByHelperInternalId,
 * decisions 184/189) — count and average in SQL, never the rows. A
 * rating whose case is currently HIDDEN is excluded by the JOIN and comes
 * back when the case is unhidden (187: a hidden case is suspected abuse,
 * and a colluding reporter/helper pair is the obvious way to inflate
 * reputation). Freeze (141) and purge (131) change nothing here.
 */
export async function aggregateByHelperInternalId(
  helperAccountId: number
): Promise<HelperRatingAggregateRow> {
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS count, AVG(r.score) AS average
     FROM tb_helper_rating r
     JOIN tb_report p ON p.id = r.tb_report_id AND p.hidden = 'N'
     WHERE r.helper_account_id = ? AND r.deleted = 'N'`,
    [helperAccountId]
  )
  const row = rows[0]
  return {
    count: Number(row?.count ?? 0),
    average: row?.average == null ? null : Number(row.average),
  }
}
