import { Request, Response } from 'express'
import * as service from '@modules/ratings/helper-rating.service'
import { rateHelperDto } from '@modules/ratings/helper-rating.dto'
import { appActorOf } from '@shared/http/app-actor'
import { handleError, parseBody, parseIdParam } from '@shared/http/controller-utils'

/** The rater is the app actor of shared/http/app-actor (RatingActor is
 *  that shape): the session account and/or the report's bearer clientKey
 *  — a HEADER, never a URL parameter (a URL leaks into logs and
 *  referrers). Route ids (:reportId / :offerId) come through parseIdParam,
 *  merged from the mount path in app.ts. */

export async function rate(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseIdParam(req, res, 'reportId')
    if (reportId === null) return
    const offerId = parseIdParam(req, res, 'offerId')
    if (offerId === null) return
    const body = parseBody(rateHelperDto, req, res)
    if (body === null) return
    const { replayed, ...rating } = await service.rateHelper(reportId, offerId, body, appActorOf(req))
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
