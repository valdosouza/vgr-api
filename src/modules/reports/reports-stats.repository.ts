import pool from '@shared/db/connection'
import {
  Category,
  ReportStatsTotalsRow,
  ReportStatus,
  StatsGranularity,
  StatsRange,
  Subject,
} from '@modules/reports/reports.interface'
import { ModerationReason } from '@shared/moderation/moderation-reason'

/**
 * Aggregate queries of B4 (decision 164). Every statement:
 *
 *  - GROUPs BY a column and returns COUNTs only — no row id, no
 *    position, no identity column is ever selected (164/135/23);
 *  - ranges over `tb_report.created_at` with the bounds as parameters
 *    (`from` inclusive; `to` `<` when the input was date-only, `<=`
 *    otherwise — the B1 search rules);
 *  - counts living rows (`deleted = 'N'`) and INCLUDES purged ones: the
 *    purge keeps the statistical skeleton precisely for this (25/131).
 *
 * The k = 5 floor is NOT applied here: the service floors AFTER summing
 * (byTier is summed from the raw byCategory counts).
 */

function rangeWhere(range: StatsRange, alias = ''): { sql: string; params: unknown[] } {
  const column = alias ? `${alias}.created_at` : 'created_at'
  const deleted = alias ? `${alias}.deleted` : 'deleted'
  return {
    sql: `${deleted} = 'N' AND ${column} >= ? AND ${column} ${range.toExclusive ? '<' : '<='} ?`,
    params: [range.from, range.to],
  }
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

/**
 * Period key per granularity — an allowlisted SQL expression, never
 * user input (the DTO validates the enum). Week is the ISO week
 * (`YEARWEEK(created_at, 3)`: Monday-first, week 1 holds January 4th)
 * rendered as `YYYY-Www` — the same key `date-fns` / the panel can
 * compute, and the one that does not split a week across two years.
 */
const PERIOD_KEY: Record<StatsGranularity, string> = {
  day: `DATE_FORMAT(created_at, '%Y-%m-%d')`,
  week: `CONCAT(LEFT(YEARWEEK(created_at, 3), 4), '-W', RIGHT(YEARWEEK(created_at, 3), 2))`,
  month: `DATE_FORMAT(created_at, '%Y-%m')`,
}

export async function countByPeriod(
  range: StatsRange,
  granularity: StatsGranularity
): Promise<Array<{ period: string; reports: number }>> {
  const where = rangeWhere(range)
  const [rows] = await pool.query<any[]>(
    `SELECT ${PERIOD_KEY[granularity]} AS period, COUNT(*) AS reports
     FROM tb_report
     WHERE ${where.sql}
     GROUP BY period
     ORDER BY period`,
    where.params
  )
  return rows.map((row) => ({ period: String(row.period), reports: num(row.reports) }))
}

/** One row of SUM(CASE ...) — the definitions the feature doc states. */
export async function countTotals(range: StatsRange): Promise<ReportStatsTotalsRow> {
  const where = rangeWhere(range, 'r')
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS reports,
            SUM(CASE WHEN r.status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN r.anonymous = 'S' THEN 1 ELSE 0 END) AS anonymous,
            SUM(CASE WHEN r.anonymous = 'N' THEN 1 ELSE 0 END) AS identified,
            SUM(CASE WHEN r.frozen = 'S' THEN 1 ELSE 0 END) AS frozen,
            SUM(CASE WHEN r.hidden = 'S' THEN 1 ELSE 0 END) AS hidden,
            SUM(CASE WHEN r.status = 'resolved' AND r.expires_at IS NOT NULL AND r.expires_at <= NOW()
                     THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN r.purged = 'S' THEN 1 ELSE 0 END) AS purged,
            SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM tb_report_media rm
                  JOIN tb_media m ON m.id = rm.tb_media_id AND m.deleted = 'N'
                  WHERE rm.tb_report_id = r.id AND rm.deleted = 'N')
                     THEN 1 ELSE 0 END) AS withMedia
     FROM tb_report r
     WHERE ${where.sql}`,
    where.params
  )
  const row = rows[0] ?? {}
  return {
    reports: num(row.reports),
    open: num(row.open),
    resolved: num(row.resolved),
    anonymous: num(row.anonymous),
    identified: num(row.identified),
    frozen: num(row.frozen),
    hidden: num(row.hidden),
    expired: num(row.expired),
    purged: num(row.purged),
    withMedia: num(row.withMedia),
  }
}

/** NULL category = free-tag reports, kept as its own group. */
export async function countByCategory(
  range: StatsRange
): Promise<Array<{ category: Category | null; reports: number }>> {
  const where = rangeWhere(range)
  const [rows] = await pool.query<any[]>(
    `SELECT category, COUNT(*) AS reports
     FROM tb_report
     WHERE ${where.sql}
     GROUP BY category
     ORDER BY category`,
    where.params
  )
  return rows.map((row) => ({
    category: (row.category as Category) ?? null,
    reports: num(row.reports),
  }))
}

export async function countBySubject(
  range: StatsRange
): Promise<Array<{ subject: Subject; reports: number }>> {
  const where = rangeWhere(range)
  const [rows] = await pool.query<any[]>(
    `SELECT subject, COUNT(*) AS reports
     FROM tb_report
     WHERE ${where.sql}
     GROUP BY subject
     ORDER BY subject`,
    where.params
  )
  return rows.map((row) => ({ subject: row.subject as Subject, reports: num(row.reports) }))
}

export async function countByStatus(
  range: StatsRange
): Promise<Array<{ status: ReportStatus; reports: number }>> {
  const where = rangeWhere(range)
  const [rows] = await pool.query<any[]>(
    `SELECT status, COUNT(*) AS reports
     FROM tb_report
     WHERE ${where.sql}
     GROUP BY status
     ORDER BY status`,
    where.params
  )
  return rows.map((row) => ({ status: row.status as ReportStatus, reports: num(row.reports) }))
}

/** Reports created in range that are CURRENTLY hidden (162), by the
 *  catalog code (163). The note and the actor never leave. */
export async function countHiddenByReason(
  range: StatsRange
): Promise<Array<{ reasonCode: ModerationReason; reports: number }>> {
  const where = rangeWhere(range)
  const [rows] = await pool.query<any[]>(
    `SELECT hidden_reason_code AS reasonCode, COUNT(*) AS reports
     FROM tb_report
     WHERE ${where.sql} AND hidden = 'S'
     GROUP BY hidden_reason_code
     ORDER BY hidden_reason_code`,
    where.params
  )
  return rows.map((row) => ({ reasonCode: row.reasonCode as ModerationReason, reports: num(row.reports) }))
}

/** Living media currently `blocked` (162) attached to reports created in
 *  range, by the catalog code. SQL over tb_media / tb_report_media is
 *  table access, not a module import (posture of reports.repository). */
export async function countBlockedMediaByReason(
  range: StatsRange
): Promise<Array<{ reasonCode: ModerationReason; media: number }>> {
  const where = rangeWhere(range, 'r')
  const [rows] = await pool.query<any[]>(
    `SELECT m.blocked_reason_code AS reasonCode, COUNT(*) AS media
     FROM tb_media m
     JOIN tb_report_media rm ON rm.tb_media_id = m.id AND rm.deleted = 'N'
     JOIN tb_report r ON r.id = rm.tb_report_id AND r.deleted = 'N'
     WHERE m.deleted = 'N' AND m.status = 'blocked' AND ${where.sql}
     GROUP BY m.blocked_reason_code
     ORDER BY m.blocked_reason_code`,
    where.params
  )
  return rows.map((row) => ({ reasonCode: row.reasonCode as ModerationReason, media: num(row.media) }))
}
