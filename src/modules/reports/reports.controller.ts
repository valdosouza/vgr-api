import { Request, Response } from 'express'
import * as service from '@modules/reports/reports.service'
import { submitReportDto } from '@modules/reports/reports.dto'
import { handleError, parseBody } from '@shared/http/controller-utils'

export async function submit(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(submitReportDto, req, res)
    if (body === null) return

    const result = await service.submitReport(
      {
        clientKey: body.clientKey,
        category: body.category ?? null,
        freeTag: body.freeTag ?? null,
        subject: body.subject,
        detailFields: body.detailFields ?? null,
        lat: body.position.lat,
        lng: body.position.lng,
        anonymous: body.anonymous,
      },
      { accountId: req.appAccountId ?? null, ip: req.ip ?? '' }
    )

    // Replay of the offline queue answers 200 with the SAME report
    // (decision 137) — the client can't tell a retry from a first accept,
    // and that is the point.
    res.status(result.replayed ? 200 : 201).json({
      reportId: result.reportId,
      status: result.status,
    })
  } catch (err) {
    handleError(res, err, 'reports.submit')
  }
}
