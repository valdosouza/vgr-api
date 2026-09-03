import { Request, Response } from 'express'
import * as service from '@modules/reports/reports-admin.service'
import { reportSearchQueryDto } from '@modules/reports/reports-admin.dto'
import { handleError, parseId, zodToFields } from '@shared/http/controller-utils'
import { auditFromRequest } from '@shared/audit/admin-audit'
import { ErrorCodes } from '@shared/errors/error-codes'

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
