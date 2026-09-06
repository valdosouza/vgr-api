import { Request, Response } from 'express'
import * as service from '@modules/help-matching/help-matching.service'
import { feedQueryDto } from '@modules/help-matching/help-matching.dto'
import { handleError, parseQuery } from '@shared/http/controller-utils'

export async function feed(req: Request, res: Response): Promise<void> {
  try {
    const query = parseQuery(feedQueryDto, req, res)
    if (query === null) return
    res.json(await service.listNearbyReports(query))
  } catch (err) {
    handleError(res, err, 'help-matching.feed')
  }
}
