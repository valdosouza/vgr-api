import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/ratings/helper-rating.controller'

/**
 * Helper rating (RT1 of plano-rating.md — decisions 48, 178-189), app
 * plane, never /api. Two routers because the two routes live on two
 * prefixes:
 *
 *  - `reportRatingRoutes` is mounted by app.ts on the FULL path
 *    /app-reports/:reportId/offers/:offerId/rating with `mergeParams`
 *    (the mechanism gateway/router.ts uses for the chat evidence read,
 *    C3), BEFORE the /app-reports mount: the request is rate-limited
 *    once, the reports router never sees it, and neither module imports
 *    the other. optionalAppAuth: the owner may be the anonymous reporter
 *    presenting the report's clientKey (134/137).
 *  - the default router is mounted at /app-ratings; `/me` runs
 *    appAuthMiddleware (token REQUIRED): only an account has a
 *    reputation to read, and only its own (184/185).
 *
 * Append-only (183): no PUT, no DELETE. Panel reading (RT3, decision
 * 186) is a separate phase.
 */

/**
 * @swagger
 * /app-reports/{reportId}/offers/{offerId}/rating:
 *   post:
 *     summary: The report owner rates one help offer of a RESOLVED case with an integer 1..5, once; idempotent by clientKey; only a helper with an account (decisions 48/180-183/188)
 *     security: []
 *     tags: [Ratings]
 */
export const reportRatingRoutes = Router({ mergeParams: true })
reportRatingRoutes.post('/', optionalAppAuth, controller.rate)

/**
 * @swagger
 * /app-ratings/me:
 *   get:
 *     summary: The authenticated helper's OWN aggregate — count, and average only from 5 ratings on (decisions 184/185/187)
 *     tags: [Ratings]
 */
const router = Router()
router.get('/me', appAuthMiddleware, controller.me)

export default router
