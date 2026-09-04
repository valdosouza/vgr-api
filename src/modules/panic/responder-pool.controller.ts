import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { responderPoolRequestDto, responderPoolResolveDto } from '@modules/panic/responder-pool.dto'
import * as service from '@modules/panic/responder-pool.service'

/**
 * Mounted on the APP plane at POST /app-panic/responder-pool, guarded by
 * appAuthMiddleware (plane fix, PP1 of plano-panico.md, decisions
 * 51/190): the requester is a mobile user's APP account
 * (tb_user_account.id), never an admin's panel identity — req.user is
 * ALWAYS undefined on this route (the two auth planes never cross,
 * decision 119). Previously this handler ran under the admin-only /api
 * router and read req.user!.userId, which made the endpoint unreachable
 * by a real mobile user and, had an admin JWT ever reached it, would
 * have stored the wrong id's semantics.
 */
export async function create(req: Request, res: Response) {
  const body = parseBody(responderPoolRequestDto, req, res)
  if (body === null) return

  try {
    const membership = await service.requestResponderAuthorization(req.appAccountId!, body.criteriaNotes)
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
