import { Router } from 'express'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/reports/reports.controller'

/**
 * Report submission (R1 — decisions 134-142), mounted under /app-reports:
 * app plane, outside /api (amendment E1). Anonymous submission is the
 * product's core promise (decisions 32/123) — optionalAppAuth lets a bare
 * request through and the Legal Gate decides whether THIS INSTALLATION
 * may accept anonymous reports (capability `report.anonymous`, enforced
 * in the service so the logged-in-choosing-anonymity case is covered too).
 *
 * Feed, detail and lifecycle routes arrive with R2/R3.
 */
const router = Router()

/**
 * @swagger
 * /app-reports:
 *   post:
 *     summary: Submits a report (anonymous or authenticated); idempotent by clientKey (decisions 123/137/140)
 *     security: []
 *     tags: [Reports]
 */
router.post('/', optionalAppAuth, controller.submit)

export default router
