import { NextFunction, Request, Response, Router } from 'express'
import multer from 'multer'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import * as controller from '@modules/media/media.controller'
import { mediaConfig } from '@shared/config/env'
import { ErrorCodes } from '@shared/errors/error-codes'

/**
 * Media (decisions 126-131, plano-imagens.md), mounted under /app-media —
 * app plane, outside /api.
 *
 * Upload accepts ANONYMOUS requests on purpose: reporting with photos
 * never requires an account (decisions 32/35), and the report itself never
 * waits for the upload (decision 123 — attachments come later from the
 * offline queue, decision 28). Reading back is owner-only; anonymous
 * uploads are served through their report once M2 wires it.
 */
const router = Router()

/** Runs app auth only when a token is present; bare requests stay
 *  anonymous instead of being rejected. */
function optionalAppAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.headers.authorization) {
    void appAuthMiddleware(req, res, next)
    return
  }
  next()
}

const uploadLimits = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: mediaConfig().maxBytes, files: 1 },
})

/** Translates multer's size abort into the decision-129 contract. */
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadLimits.single('file')(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({
        error: 'Validation failed',
        code: ErrorCodes.VALIDATION_FAILED,
        fields: [
          {
            field: 'file',
            message: 'File exceeds the size limit',
            code: 'TOO_LONG',
            params: { max: String(mediaConfig().maxBytes) },
          },
        ],
      })
      return
    }
    next()
  })
}

/**
 * @swagger
 * /app-media:
 *   post:
 *     summary: Uploads an image through the ingest pipeline (re-encode strips EXIF; decisions 129/130)
 *     security: []
 *     tags: [Media]
 * /app-media/{publicId}/{variant}:
 *   get:
 *     summary: Streams an owned media variant (normalized|thumb|blur); original is panel-only (decision 130)
 *     tags: [Media]
 */
router.post('/', optionalAppAuth, handleUpload, controller.upload)
router.get('/:publicId/:variant', appAuthMiddleware, controller.stream)
router.get('/:publicId', appAuthMiddleware, controller.stream)

export default router
