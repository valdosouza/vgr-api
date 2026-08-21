import { Request, Response } from 'express'
import * as service from '@modules/reward/reward.service'
import { createRewardOfferDto, reserveRewardDto, resolveRewardDto } from '@modules/reward/reward.dto'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'

/** App plane — the reporter's own actions on their report's reward. */
export async function offer(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseId(req, res)
    if (reportId === null) return
    const body = parseBody(createRewardOfferDto, req, res)
    if (body === null) return

    const result = await service.offerReward(
      { reportId, amountCents: body.amountCents },
      { accountId: req.appAccountId! }
    )
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'reward.offer')
  }
}

export async function reserve(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseId(req, res)
    if (reportId === null) return
    const body = parseBody(reserveRewardDto, req, res)
    if (body === null) return

    await service.reserveGuarantee(
      { reportId, ...body },
      { accountId: req.appAccountId! }
    )
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.reserve')
  }
}

export async function state(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseId(req, res)
    if (reportId === null) return

    const offer = await service.getRewardState(reportId)
    res.status(200).json({ ok: true, data: offer })
  } catch (err) {
    handleError(res, err, 'reward.state')
  }
}

/** Panel plane — mediation: judges fulfillment for the fixed recipient set
 *  (decision 147), never chooses recipients. */
export async function resolve(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return
    const body = parseBody(resolveRewardDto, req, res)
    if (body === null) return

    await service.resolveReward(offerId, body.outcome, { userId: req.user!.userId })
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.resolve')
  }
}
