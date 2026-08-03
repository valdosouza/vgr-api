import { Request, Response } from 'express'
import * as service from '@modules/reports/reports.service'
import { editReportDto, submitReportDto } from '@modules/reports/reports.dto'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'

/** Viewer identity for ownership checks (R3): the session account and/or
 *  the bearer clientKey (decision 134's pattern) — sent as a header, never
 *  a URL parameter (a URL leaks into logs and referrers). */
function viewerOf(req: Request) {
  const header = req.headers['x-client-key']
  return {
    accountId: req.appAccountId ?? null,
    clientKey: typeof header === 'string' && header.length > 0 ? header : null,
  }
}

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

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    res.json(await service.getReportView(id, viewerOf(req)))
  } catch (err) {
    handleError(res, err, 'reports.getById')
  }
}

export async function edit(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    const body = parseBody(editReportDto, req, res)
    if (body === null) return
    res.json(await service.editReport(id, body, viewerOf(req)))
  } catch (err) {
    handleError(res, err, 'reports.edit')
  }
}

export async function resolve(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req, res)
    if (id === null) return
    res.json(await service.resolveReport(id, viewerOf(req)))
  } catch (err) {
    handleError(res, err, 'reports.resolve')
  }
}
