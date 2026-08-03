import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { dualControlApprovalDto, dualControlCreateDto } from '@modules/admin-access/dual-control.dto'
import * as service from '@modules/admin-access/dual-control.service'

export async function create(req: Request, res: Response) {
  const body = parseBody(dualControlCreateDto, req, res)
  if (body === null) return

  try {
    const created = await service.createDualControlRequest(body.accountabilityLogEntryId, body.legalBasis)
    res.status(201).json({ ok: true, data: created })
  } catch (err) {
    handleError(res, err, 'dual-control-access POST')
  }
}

export async function list(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.listDualControlRequests() })
  } catch (err) {
    handleError(res, err, 'dual-control-access GET')
  }
}

export async function approve(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return

  const body = parseBody(dualControlApprovalDto, req, res)
  if (body === null) return

  try {
    const updated = await service.addApproval(id, body.approverId)
    res.status(200).json({ ok: true, data: updated })
  } catch (err) {
    handleError(res, err, 'dual-control-access POST approvals')
  }
}
