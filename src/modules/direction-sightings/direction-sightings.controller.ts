import { Request, Response } from 'express'
import * as service from '@modules/direction-sightings/direction-sightings.service'
import { logDirectionSightingDto } from '@modules/direction-sightings/direction-sightings.dto'
import { handleError, parseBody } from '@shared/http/controller-utils'

export async function submit(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(logDirectionSightingDto, req, res)
    if (body === null) return

    const result = await service.logDirectionSighting(body, {
      accountId: req.appAccountId ?? null,
      ip: req.ip ?? '',
    })

    // Replay of the offline queue answers 200 with the SAME sighting
    // (decision 137's convention, reports.submit/panic trigger/rateHelper)
    // — the client cannot tell a retry from a first accept, on purpose.
    const { replayed, ...payload } = result
    res.status(replayed ? 200 : 201).json(payload)
  } catch (err) {
    handleError(res, err, 'direction-sightings.submit')
  }
}
