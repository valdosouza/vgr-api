import { Request, Response } from 'express'
import * as service from '@modules/reports/reports-admin.service'
import * as statsService from '@modules/reports/reports-stats.service'
import * as queueService from '@modules/reports/reports-queue.service'
import {
  reportQueueQueryDto,
  reportSearchQueryDto,
  reportStatsQueryDto,
} from '@modules/reports/reports-admin.dto'
import { handleError, parseBody, parseId, zodToFields } from '@shared/http/controller-utils'
import { auditFromRequest } from '@shared/audit/admin-audit'
import { ErrorCodes } from '@shared/errors/error-codes'
import { moderationReasonDto } from '@shared/moderation/moderation-reason'

/**
 * Panel plane of the report (B1 — decisions 159/166). Reads are audited
 * here, after the service succeeded (a 404 leaves no row): the actor and
 * IP live at the HTTP layer (implementation note on decision 116). The
 * list is deliberately NOT audited (166 — it would drown the trail).
 */

export async function search(req: Request, res: Response): Promise<void> {
  try {
    const parsed = reportSearchQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await service.searchReports(parsed.data))
  } catch (err) {
    handleError(res, err, 'reports-admin.search')
  }
}

/**
 * Statistics (B4 — decisions 164/165): aggregates under the k = 5 floor.
 * Deliberately NOT audited — aggregates are not evidence (unlike the
 * detail, 166). Range semantics (defaults, from <= to, 366 days) are the
 * service's and surface as the same 422 envelope.
 */
export async function stats(req: Request, res: Response): Promise<void> {
  try {
    const parsed = reportStatsQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await statsService.getReportStats(parsed.data))
  } catch (err) {
    handleError(res, err, 'reports-admin.stats')
  }
}

/**
 * Proactive moderation queue (B3 — decision 161). A list read, so NOT
 * audited (166): opening a case from the queue goes through `detail`,
 * which is.
 */
export async function queue(req: Request, res: Response): Promise<void> {
  try {
    const parsed = reportQueueQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await queueService.getModerationQueue(parsed.data))
  } catch (err) {
    handleError(res, err, 'reports-admin.queue')
  }
}

/**
 * Mark reviewed (B3 — decisions 161/165): one human with `reports`
 * UPDATE; no body (not a moderation act, so no reason); audited (116) as
 * state_change / report / { action: 'reviewed' } after the service
 * succeeded — a 404/409 leaves no row.
 */
export async function reviewed(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const result = await queueService.markReviewed(id, req.user!.userId)
    auditFromRequest(req, 'state_change', 'report', id, { action: 'reviewed' })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'reports-admin.reviewed')
  }
}

export async function detail(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const result = await service.getReportPanelDetail(id)
    // One row per opened detail (decision 166).
    auditFromRequest(req, 'read', 'report', id)
    res.json(result)
  } catch (err) {
    handleError(res, err, 'reports-admin.detail')
  }
}

/**
 * Moderation (B2 — decisions 162/163/167): every act leaves an audit row
 * with the catalog reason and the note (116); the acting user becomes
 * hidden_by. The note is always present in the summary (null when not
 * given) so the trail has one shape.
 */
export async function hide(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const body = parseBody(moderationReasonDto, req, res)
    if (body === null) return

    const result = await service.hideReport(id, body, req.user!.userId)
    auditFromRequest(req, 'state_change', 'report', id, {
      action: 'hide',
      reasonCode: body.reasonCode,
      note: body.note ?? null,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'reports-admin.hide')
  }
}

export async function unhide(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const body = parseBody(moderationReasonDto, req, res)
    if (body === null) return

    const result = await service.unhideReport(id, body, req.user!.userId)
    auditFromRequest(req, 'state_change', 'report', id, {
      action: 'unhide',
      reasonCode: body.reasonCode,
      note: body.note ?? null,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'reports-admin.unhide')
  }
}

export async function exactPosition(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const result = await service.getReportExactPosition(id)
    // The audited flow decision 135 foresaw (decision 159).
    auditFromRequest(req, 'read', 'report_position', id)
    // No caching: a cached exact position would be an unaudited read.
    res.setHeader('Cache-Control', 'no-store')
    res.json(result)
  } catch (err) {
    handleError(res, err, 'reports-admin.exactPosition')
  }
}
