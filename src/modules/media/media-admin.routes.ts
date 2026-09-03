import { NextFunction, Request, Response, Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/media/media.controller'

/**
 * Panel plane (M3 of plano-imagens.md) — mounted under /api/media, behind
 * authMiddleware like all of /api. Two stacked guards (pattern of the
 * dual-control routes): reviewing evidence derivatives needs
 * media_evidence; the EXIF original ADDITIONALLY needs media_original,
 * which migration 029 grants to nobody by default (decision 130 — the
 * original is reporter-reidentifying data).
 *
 * B2 (decisions 162/165) adds block/unblock: a moderation act, so it is
 * guarded by `reports` UPDATE — media_evidence only READS. Blocked media
 * disappears from the app plane but stays readable here (a hold
 * preserves evidence).
 */
const router = Router()

/** The extra gate only exists on the reidentifying variant. */
function requireOriginalGrant(req: Request, res: Response, next: NextFunction): void {
  if (req.params.variant === 'original') {
    void requirePrivilege(InterfaceKeys.MEDIA_ORIGINAL, Privileges.VIEW)(req, res, next)
    return
  }
  next()
}

/**
 * @swagger
 * /api/media/{publicId}/{variant}:
 *   get:
 *     summary: Streams a media variant to the panel; every read is audited (decisions 116/130)
 *     tags: [Media]
 * /api/media/{publicId}/block:
 *   post:
 *     summary: available -> blocked with a catalog reason — one human with reports UPDATE, audited (decisions 162/163)
 *     tags: [Media]
 * /api/media/{publicId}/unblock:
 *   post:
 *     summary: blocked -> available under the same single-human rule, reason mandatory (decision 162)
 *     tags: [Media]
 */
router.post(
  '/:publicId/block',
  requirePrivilege(InterfaceKeys.REPORTS, Privileges.UPDATE),
  controller.adminBlock
)
router.post(
  '/:publicId/unblock',
  requirePrivilege(InterfaceKeys.REPORTS, Privileges.UPDATE),
  controller.adminUnblock
)
router.get(
  '/:publicId/:variant',
  requirePrivilege(InterfaceKeys.MEDIA_EVIDENCE, Privileges.VIEW),
  requireOriginalGrant,
  controller.adminStream
)
router.get(
  '/:publicId',
  requirePrivilege(InterfaceKeys.MEDIA_EVIDENCE, Privileges.VIEW),
  controller.adminStream
)

export default router
