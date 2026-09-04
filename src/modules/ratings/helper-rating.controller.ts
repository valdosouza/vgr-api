import { Request, Response } from 'express'
import * as service from '@modules/ratings/helper-rating.service'
import { rateHelperDto } from '@modules/ratings/helper-rating.dto'
import { RatingActor } from '@modules/ratings/helper-rating.interface'
import { ErrorCodes } from '@shared/errors/error-codes'
import { handleError, parseBody } from '@shared/http/controller-utils'

/** Actor identity exactly as reports and chat build it: the session
 *  account and/or the report's bearer clientKey — a HEADER, never a URL
 *  parameter (a URL leaks into logs and referrers). */
function actorOf(req: Request): RatingActor {
  const header = req.headers['x-client-key']
  return {
    accountId: req.appAccountId ?? null,
    clientKey: typeof header === 'string' && header.length > 0 ? header : null,
    ip: req.ip ?? '',
  }
}

/** parseId for a named route parameter (:reportId / :offerId), merged
 *  from the mount path in app.ts. */
function parseIdParam(req: Request, res: Response, name: string): number | null {
  const id = Number(req.params[name])
  if (!Number.isInteger(id) || id < 0) {
    res.status(400).json({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
    return null
  }
  return id
}

export async function rate(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseIdParam(req, res, 'reportId')
    if (reportId === null) return
    const offerId = parseIdParam(req, res, 'offerId')
    if (offerId === null) return
    const body = parseBody(rateHelperDto, req, res)
    if (body === null) return
    const { replayed, ...rating } = await service.rateHelper(reportId, offerId, body, actorOf(req))
    // Replay of the offline queue answers 200 with the SAME rating
    // (decisions 137/183, the reports.submit convention) — the client
    // cannot tell a retry from a first accept, and that is the point.
    res.status(replayed ? 200 : 201).json(rating)
  } catch (err) {
    handleError(res, err, 'ratings.rate')
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  try {
    // appAuthMiddleware guarantees the account (184): never optional here.
    res.json(await service.getMyReputation(req.appAccountId as number))
  } catch (err) {
    handleError(res, err, 'ratings.me')
  }
}
