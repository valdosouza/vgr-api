import { Request, Response } from 'express'
import { handleError, parseBody, parseId, parseQuery } from '@shared/http/controller-utils'
import { dualControlCreateDto, dualControlListQueryDto } from '@modules/admin-access/dual-control.dto'
import * as service from '@modules/admin-access/dual-control.service'
import { auditFromRequest } from '@shared/audit/admin-audit'

/** Decision 45 gate. The actor is ALWAYS the session (`req.user`, decision
 *  223) — never a body field — and both steps leave an admin-audit row
 *  (116, decision 226), written after the change succeeds. */

export async function create(req: Request, res: Response) {
  const body = parseBody(dualControlCreateDto, req, res)
  if (body === null) return

  try {
    const created = await service.createDualControlRequest(
      body.accountabilityLogEntryId,
      body.legalBasis,
      req.user!.userId
    )
    auditFromRequest(req, 'state_change', 'dual_control_access', created.id, {
      action: 'request',
      accountabilityLogEntryId: body.accountabilityLogEntryId,
      legalBasis: body.legalBasis,
    })
    res.status(201).json({ ok: true, data: created })
  } catch (err) {
    handleError(res, err, 'dual-control-access POST')
  }
}

export async function list(req: Request, res: Response) {
  const query = parseQuery(dualControlListQueryDto, req, res)
  if (query === null) return
  try {
    res.status(200).json({ ok: true, data: await service.listDualControlRequests(query) })
  } catch (err) {
    handleError(res, err, 'dual-control-access GET')
  }
}

export async function approve(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return

  try {
    const updated = await service.approveDualControlRequest(id, req.user!.userId)
    auditFromRequest(req, 'state_change', 'dual_control_access', id, { action: 'approve' })
    res.status(200).json({ ok: true, data: updated })
  } catch (err) {
    handleError(res, err, 'dual-control-access POST approvals')
  }
}
