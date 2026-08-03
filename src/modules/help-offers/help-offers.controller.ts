import { Request, Response } from 'express'
import * as service from '@modules/help-offers/help-offers.service'
import { submitHelpOfferDto } from '@modules/help-offers/help-offers.dto'
import { handleError, parseBody } from '@shared/http/controller-utils'

export async function submit(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(submitHelpOfferDto, req, res)
    if (body === null) return

    const result = await service.submitHelpOffer(body, {
      accountId: req.appAccountId ?? null,
      ip: req.ip ?? '',
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'help-offers.submit')
  }
}
