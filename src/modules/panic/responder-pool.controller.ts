import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { responderPoolRequestDto, responderPoolResolveDto } from '@modules/panic/responder-pool.dto'
import * as service from '@modules/panic/responder-pool.service'

export async function create(req: Request, res: Response) {
  const body = parseBody(responderPoolRequestDto, req, res)
  if (body === null) return

  try {
    const membership = await service.requestResponderAuthorization(req.user!.userId, body.criteriaNotes)
    res.status(201).json({ ok: true, data: membership })
  } catch (err) {
    handleError(res, err, 'panic/responder-pool POST')
  }
}

export async function list(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.listPendingResponderRequests() })
  } catch (err) {
    handleError(res, err, 'panic/responder-pool GET')
  }
}

export async function resolve(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return

  const body = parseBody(responderPoolResolveDto, req, res)
  if (body === null) return

  try {
    await service.resolveResponderRequest(id, body.approved, req.user!.userId)
    res.status(200).json({ ok: true, data: { id, approved: body.approved } })
  } catch (err) {
    handleError(res, err, 'panic/responder-pool PUT resolve')
  }
}
