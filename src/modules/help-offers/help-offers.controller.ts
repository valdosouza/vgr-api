import { Request, Response } from 'express'
import * as service from '@modules/help-offers/help-offers.service'
import { submitHelpOfferDto, updateHelpOfferTypesDto } from '@modules/help-offers/help-offers.dto'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
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

/** PUT /app-help-offers/:id/types (decision 211) — app auth required. */
export async function updateTypes(req: Request, res: Response): Promise<void> {
  try {
    const helpOfferId = Number(req.params.id)
    if (!Number.isInteger(helpOfferId) || helpOfferId <= 0) {
      throw new HttpError(422, 'Invalid help offer id', undefined, ErrorCodes.INVALID_ID)
    }
    const body = parseBody(updateHelpOfferTypesDto, req, res)
    if (body === null) return

    const result = await service.updateHelpOfferTypes(
      { helpOfferId, helpTypes: body.helpTypes },
      { accountId: req.appAccountId as number }
    )
    res.status(200).json(result)
  } catch (err) {
    handleError(res, err, 'help-offers.updateTypes')
  }
}
