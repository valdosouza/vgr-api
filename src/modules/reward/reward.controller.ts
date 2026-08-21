import { Request, Response } from 'express'
import * as service from '@modules/reward/reward.service'
import {
  closeContestDto,
  contestResolutionDto,
  createRewardOfferDto,
  onboardRecipientDto,
  proposeResolutionDto,
  publishCriteriaDto,
  reserveRewardDto,
} from '@modules/reward/reward.dto'
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

/** The helper's own onboarding to receive payouts — KYC goes straight to
 *  the rail, only the opaque recipient id is kept (decision 143). */
export async function onboard(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(onboardRecipientDto, req, res)
    if (body === null) return

    await service.onboardAsRecipient(body, { accountId: req.appAccountId! })
    res.status(201).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.onboard')
  }
}

export async function onboardingStatus(req: Request, res: Response): Promise<void> {
  try {
    const status = await service.getOnboardingStatus(req.appAccountId!)
    res.status(200).json({ ok: true, data: status })
  } catch (err) {
    handleError(res, err, 'reward.onboardingStatus')
  }
}

/** App plane — the rules of the game (decision 150), and a party's
 *  contest while the money is still retained (decision 149). */
export async function activeCriteria(_req: Request, res: Response): Promise<void> {
  try {
    res.status(200).json({ ok: true, data: await service.getActiveCriteria() })
  } catch (err) {
    handleError(res, err, 'reward.activeCriteria')
  }
}

export async function contest(req: Request, res: Response): Promise<void> {
  try {
    const reportId = parseId(req, res)
    if (reportId === null) return
    const body = parseBody(contestResolutionDto, req, res)
    if (body === null) return

    const result = await service.contestResolution(reportId, body.body, {
      accountId: req.appAccountId!,
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'reward.contest')
  }
}

/** Panel plane — the mediation discipline (decisions 98/148/149/150):
 *  propose -> approve (distinct user) -> contest window -> execute. */
export async function publishCriteria(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(publishCriteriaDto, req, res)
    if (body === null) return

    const result = await service.publishCriteria(body.version, body.body, {
      userId: req.user!.userId,
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'reward.publishCriteria')
  }
}

export async function propose(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return
    const body = parseBody(proposeResolutionDto, req, res)
    if (body === null) return

    const result = await service.proposeResolution(offerId, body.outcome, body.reason, {
      userId: req.user!.userId,
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'reward.propose')
  }
}

export async function approve(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return

    const result = await service.approveResolution(offerId, { userId: req.user!.userId })
    res.status(200).json({ ok: true, ...result })
  } catch (err) {
    handleError(res, err, 'reward.approve')
  }
}

export async function cancel(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return

    await service.cancelResolution(offerId, { userId: req.user!.userId })
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.cancel')
  }
}

export async function closeContest(req: Request, res: Response): Promise<void> {
  try {
    const contestId = parseId(req, res)
    if (contestId === null) return
    const body = parseBody(closeContestDto, req, res)
    if (body === null) return

    await service.closeContest(contestId, body.note, { userId: req.user!.userId })
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.closeContest')
  }
}

export async function execute(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return

    await service.executeResolution(offerId, { userId: req.user!.userId })
    res.status(200).json({ ok: true })
  } catch (err) {
    handleError(res, err, 'reward.execute')
  }
}

export async function mediationState(req: Request, res: Response): Promise<void> {
  try {
    const offerId = parseId(req, res)
    if (offerId === null) return

    res.status(200).json({ ok: true, data: await service.getMediationState(offerId) })
  } catch (err) {
    handleError(res, err, 'reward.mediationState')
  }
}
