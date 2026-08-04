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

/**
 * @swagger
 * /app-reports/{id}:
 *   get:
 *     summary: Report view — owner/participant full, public degraded, resolved summary (decisions 50/135)
 *     security: []
 *   put:
 *     summary: Edits the reporter's own words on an open, unfrozen report (decision 19)
 *     security: []
 * /app-reports/{id}/resolve:
 *   post:
 *     summary: Resolves the report; helpers stay linked, retention clock starts (decisions 18/131)
 *     security: []
 */
/**
 * @swagger
 * /app-reports/category-forms:
 *   get:
 *     summary: Every category's detail-form schema in one read — the app caches it for offline rendering (decision 47)
 *     security: []
 */
// Registered BEFORE '/:id' so the literal segment never parses as an id.
router.get('/category-forms', controller.categoryForms)

router.get('/:id', optionalAppAuth, controller.getById)
router.put('/:id', optionalAppAuth, controller.edit)
router.post('/:id/resolve', optionalAppAuth, controller.resolve)

/**
 * @swagger
 * /app-reports/{id}/media:
 *   post:
 *     summary: Attaches an uploaded media to the report — publicId as bearer secret, one attach, limit per report (decisions 129/134/138)
 *     security: []
 * /app-reports/{id}/media/{mediaPublicId}/{variant}:
 *   get:
 *     summary: Streams an attached derivative under the report's visibility; public high-tier gets blur only (decisions 128/135)
 *     security: []
 */
router.post('/:id/media', optionalAppAuth, controller.attachMedia)
router.get('/:id/media/:mediaPublicId/:variant', optionalAppAuth, controller.streamMedia)
router.get('/:id/media/:mediaPublicId', optionalAppAuth, controller.streamMedia)

export default router
