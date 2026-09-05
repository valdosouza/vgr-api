import pool from '@shared/db/connection'
import { Category } from '@shared/taxonomy/taxonomy'
import { DirectionAccumulatorRow, Direction } from '@shared/direction-sighting/direction-estimate'
import {
  DirectionSightingRow,
  ReportForSightingRow,
} from '@modules/direction-sightings/direction-sightings.interface'

/**
 * Persistence of the DirectionSighting/DirectionEstimate aggregates
 * (migration 047). SQL over tb_report here is table access, not a module
 * import — same posture as help-offers.repository.ts's
 * findReportForOffer.
 */

/** The guard columns the service needs (existence/eligibility/self-
 *  dealing/open-status) — mirrors help-offers' findReportForOffer shape,
 *  plus `category` for the eligibility gate (201). */
export async function findReportForSighting(reportId: number): Promise<ReportForSightingRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, reporter_account_id AS reporterAccountId, status, category
     FROM tb_report WHERE id = ? AND deleted = 'N' AND purged = 'N'`,
    [reportId]
  )
  if (!rows[0]) return null
  return {
    id: rows[0].id,
    reporterAccountId: rows[0].reporterAccountId ?? null,
    status: rows[0].status,
    category: (rows[0].category as Category) ?? null,
  }
}

function toSighting(row: any): DirectionSightingRow {
  return {
    id: row.id,
    reportId: row.reportId,
    direction: row.direction as Direction,
    weight: Number(row.weight),
    accountId: row.accountId ?? null,
    clientKey: row.clientKey,
    createdAt: row.createdAt,
  }
}

const SIGHTING_SELECT = `
  SELECT id, tb_report_id AS reportId, direction, weight,
         account_id AS accountId, client_key AS clientKey, created_at AS createdAt
  FROM tb_direction_sighting`

/** Idempotency lookup (28/137): a replay of the same clientKey answers
 *  the SAME sighting, never a duplicate row. */
export async function findSightingByClientKey(clientKey: string): Promise<DirectionSightingRow | null> {
  const [rows] = await pool.query<any[]>(`${SIGHTING_SELECT} WHERE client_key = ?`, [clientKey])
  return rows[0] ? toSighting(rows[0]) : null
}

/**
 * Append the sighting AND update the O(1) materialized aggregate in ONE
 * transaction (decision 22: the synchronous response must reflect this
 * exact insert, and the two tables must never drift). `first_reported_at`
 * is set ONLY by the INSERT branch of the upsert — the ON DUPLICATE KEY
 * UPDATE clause never touches it, since it is the reconciliation
 * algorithm's deterministic tie-break key (decision 26,
 * shared/direction-sighting/direction-estimate.ts).
 */
export async function insertSighting(input: {
  reportId: number
  direction: Direction
  weight: number
  accountId: number | null
  clientKey: string
}): Promise<DirectionSightingRow> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result] = await conn.query<any>(
      `INSERT INTO tb_direction_sighting (tb_report_id, direction, weight, account_id, client_key)
       VALUES (?, ?, ?, ?, ?)`,
      [input.reportId, input.direction, input.weight, input.accountId, input.clientKey]
    )
    await conn.query(
      `INSERT INTO tb_direction_estimate (tb_report_id, direction, total_weight, sighting_count, first_reported_at)
       VALUES (?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         total_weight = total_weight + VALUES(total_weight),
         sighting_count = sighting_count + 1`,
      [input.reportId, input.direction, input.weight]
    )
    const [rows] = await conn.query<any[]>(`${SIGHTING_SELECT} WHERE id = ?`, [result.insertId])
    await conn.commit()
    return toSighting(rows[0])
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/** The reconciliation input for ONE report (decisions 22/26/202) — at
 *  most 8 rows (one per compass point), cheap to read on every request.
 *  Used by this module's own service (write response) AND, via each
 *  consuming module's OWN copy of this same query shape (table access,
 *  not a module import), by reports.repository.ts and
 *  help-matching.repository.ts for their READ facets. */
export async function findEstimateRows(reportId: number): Promise<DirectionAccumulatorRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT direction, total_weight AS totalWeight, sighting_count AS sightingCount,
            first_reported_at AS firstReportedAt
     FROM tb_direction_estimate
     WHERE tb_report_id = ?`,
    [reportId]
  )
  return rows.map((row) => ({
    direction: row.direction as Direction,
    totalWeight: Number(row.totalWeight),
    sightingCount: row.sightingCount,
    firstReportedAt: row.firstReportedAt,
  }))
}
