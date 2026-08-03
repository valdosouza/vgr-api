import { Request, Response } from 'express'
import * as service from '@modules/help-matching/help-matching.service'
import { feedQueryDto } from '@modules/help-matching/help-matching.dto'
import { handleError, zodToFields } from '@shared/http/controller-utils'
import { ErrorCodes } from '@shared/errors/error-codes'

export async function feed(req: Request, res: Response): Promise<void> {
  try {
    const parsed = feedQueryDto.safeParse(req.query)
    if (!parsed.success) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: zodToFields(parsed.error),
      })
      return
    }
    res.json(await service.listNearbyReports(parsed.data))
  } catch (err) {
    handleError(res, err, 'help-matching.feed')
  }
}
