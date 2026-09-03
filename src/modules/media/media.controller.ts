import { Request, Response } from 'express'
import * as service from '@modules/media/media.service'
import { mediaVariantDto, uploadMediaDto } from '@modules/media/media.dto'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { ErrorCodes } from '@shared/errors/error-codes'
import { auditFromRequest } from '@shared/audit/admin-audit'
import { moderationReasonDto } from '@shared/moderation/moderation-reason'

export async function upload(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file
    if (!file?.buffer?.length) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: [{ field: 'file', message: 'Image file is required', code: 'REQUIRED' }],
      })
      return
    }
    const body = parseBody(uploadMediaDto, req, res)
    if (body === null) return

    const result = await service.ingest({
      data: file.buffer,
      class: body.class,
      // Set by the optional app auth; null = anonymous (decisions 32/35).
      uploaderAccountId: req.appAccountId ?? null,
      keepOriginal: body.keepOriginal,
      exifWarningVersion: body.exifWarningVersion ?? null,
    })
    res.status(201).json(result)
  } catch (err) {
    handleError(res, err, 'media.upload')
  }
}

export async function stream(req: Request, res: Response): Promise<void> {
  try {
    const variant = mediaVariantDto.safeParse(req.params.variant ?? 'normalized')
    if (!variant.success) {
      res.status(404).json({ error: 'Media not found', code: ErrorCodes.NOT_FOUND })
      return
    }
    const { data, mime } = await service.openVariant(
      req.params.publicId,
      variant.data,
      // Route is behind appAuthMiddleware — always present here.
      req.appAccountId as number
    )
    res.setHeader('Content-Type', mime)
    // Media is immutable (a new upload is a new id) — cache privately.
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(data)
  } catch (err) {
    handleError(res, err, 'media.stream')
  }
}

/** Panel plane (M3): every served read leaves an audit row — who saw
 *  which image of which case (decisions 116/130). */
export async function adminStream(req: Request, res: Response): Promise<void> {
  try {
    const variant = mediaVariantDto.safeParse(req.params.variant ?? 'normalized')
    if (!variant.success) {
      res.status(404).json({ error: 'Media not found', code: ErrorCodes.NOT_FOUND })
      return
    }
    const { data, mime } = await service.openVariantForPanel(req.params.publicId, variant.data)
    auditFromRequest(req, 'read', 'media', req.params.publicId, { variant: variant.data })
    res.setHeader('Content-Type', mime)
    // No caching on the panel: a cached view would be an unaudited view.
    res.setHeader('Cache-Control', 'no-store')
    res.send(data)
  } catch (err) {
    handleError(res, err, 'media.adminStream')
  }
}

/** Panel moderation (B2 — decisions 162/163): every act leaves an audit
 *  row with the catalog reason and the note (116); the note is always in
 *  the summary (null when not given) so the trail has one shape. */
export async function adminBlock(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(moderationReasonDto, req, res)
    if (body === null) return

    const result = await service.blockMedia(req.params.publicId, body, req.user!.userId)
    auditFromRequest(req, 'state_change', 'media', req.params.publicId, {
      action: 'block',
      reasonCode: body.reasonCode,
      note: body.note ?? null,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'media.adminBlock')
  }
}

export async function adminUnblock(req: Request, res: Response): Promise<void> {
  try {
    const body = parseBody(moderationReasonDto, req, res)
    if (body === null) return

    const result = await service.unblockMedia(req.params.publicId, body, req.user!.userId)
    auditFromRequest(req, 'state_change', 'media', req.params.publicId, {
      action: 'unblock',
      reasonCode: body.reasonCode,
      note: body.note ?? null,
    })
    res.json(result)
  } catch (err) {
    handleError(res, err, 'media.adminUnblock')
  }
}
