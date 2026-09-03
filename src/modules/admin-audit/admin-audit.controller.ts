import { Request, Response } from 'express'
import * as service from '@modules/admin-audit/admin-audit.service'
import { auditListQueryDto } from '@modules/admin-audit/admin-audit.dto'
import { handleError, parseId, zodToFields } from '@shared/http/controller-utils'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Trail READ on the panel plane (B5 — decisions 116/165/166). Every
 * action here is a read, and NONE is audited (166: auditing the audit
 * would be recursive and would drown the trail) — this controller
 * deliberately does not import shared/audit/admin-audit.
 */

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const parsed = auditListQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await service.listAuditEntries(parsed.data))
  } catch (err) {
    handleError(res, err, 'admin-audit.list')
  }
}

export async function facets(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await service.getAuditFacets())
  } catch (err) {
    handleError(res, err, 'admin-audit.facets')
  }
}

/** The single-entry read — the only response that carries the operator
 *  `ip` (personal data; the list shows who/what/when). */
export async function detail(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    res.json(await service.getAuditEntry(id))
  } catch (err) {
    handleError(res, err, 'admin-audit.detail')
  }
}
