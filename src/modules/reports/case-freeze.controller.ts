import { Request, Response } from 'express'
import * as service from '@modules/reports/reports.service'
import { freezeReasonDto } from '@modules/reports/reports.dto'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { auditFromRequest } from '@shared/audit/admin-audit'

/** Panel plane (decisions 141/142) — every state change leaves an audit
 *  row (116); the freeze reason travels in the summary. */

export async function state(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    res.json(await service.getCaseFreezeState(id))
  } catch (err) {
    handleError(res, err, 'case-freeze.state')
  }
}

export async function freeze(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const body = parseBody(freezeReasonDto, req, res)
    if (body === null) return

    const result = await service.freezeCase(id, body.reason)
    auditFromRequest(req, 'state_change', 'case_freeze', id, {
      action: 'freeze',
      reason: body.reason,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'case-freeze.freeze')
  }
}

export async function requestUnfreeze(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const body = parseBody(freezeReasonDto, req, res)
    if (body === null) return

    const result = await service.requestUnfreeze(id, body.reason, req.user!.userId)
    auditFromRequest(req, 'state_change', 'case_freeze', id, {
      action: 'unfreeze_request',
      reason: body.reason,
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'case-freeze.requestUnfreeze')
  }
}

export async function approveUnfreeze(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return

    const result = await service.approveUnfreeze(id, req.user!.userId)
    auditFromRequest(req, 'state_change', 'case_freeze', id, { action: 'unfreeze_approve' })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'case-freeze.approveUnfreeze')
  }
}
