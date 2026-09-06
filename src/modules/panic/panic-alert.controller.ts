import { Request, Response } from 'express'
import * as service from '@modules/panic/panic-alert.service'
import { panicAlertsQueryDto, triggerPanicAlertDto } from '@modules/panic/panic-alert.dto'
import { appActorOf } from '@shared/http/app-actor'
import { handleError, parseBody, parseId, parseQuery } from '@shared/http/controller-utils'

/** The caller is the app actor of shared/http/app-actor (PanicAlertActor
 *  is that shape): the session account and/or the alert's bearer
 *  clientKey — a HEADER, never a URL parameter (a URL leaks into logs and
 *  referrers). */

export async function trigger(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(triggerPanicAlertDto, req, res)
    if (body === null) return

    const result = await service.triggerAlert(
      { clientKey: body.clientKey, lat: body.position.lat, lng: body.position.lng },
      appActorOf(req)
    )

    // Replay of the offline queue answers 200 with the SAME alert
    // (decision 137's convention, reports.submit/chat post/rateHelper) —
    // the client cannot tell a retry from a first accept, on purpose.
    const { replayed, ...payload } = result
    res.status(replayed ? 200 : 201).json(payload)
  } catch (err) {
    handleError(res, err, 'panic-alert.trigger')
  }
}

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const query = parseQuery(panicAlertsQueryDto, req, res)
    if (query === null) return
    // appAuthMiddleware guarantees the account (192: only an identified,
    // currently-approved responder has anything to see here) — never
    // optional on this route.
    res.json(await service.listAlertsForResponder(req.appAccountId as number, query))
  } catch (err) {
    handleError(res, err, 'panic-alert.list')
  }
}

export async function resolve(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    res.json(await service.resolveAlert(id, appActorOf(req)))
  } catch (err) {
    handleError(res, err, 'panic-alert.resolve')
  }
}
