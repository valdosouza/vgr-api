import { Router } from 'express'
import { appAuthMiddleware } from '@gateway/app-auth.middleware'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/help-offers/help-offers.controller'

/**
 * Help offers (spec tasks 06/07, decisions 10/20/34/35; 208-214 for the
 * set of fronts), mounted under /app-help-offers — app plane. Anonymous
 * offers are a product promise (35): without a reward involved, anonymous
 * help is accepted in full; the anonymous helper is told in the app they
 * cannot claim a reward (34).
 */
const router = Router()

/**
 * @swagger
 * /app-help-offers:
 *   post:
 *     summary: Offers help on an open report with one or more fronts; self-dealing rejected (decisions 10/20/34/35/208/213)
 *     security: []
 *     tags: [HelpOffers]
 */
router.post('/', optionalAppAuth, controller.submit)

/**
 * @swagger
 * /app-help-offers/{id}/types:
 *   put:
 *     summary: Replaces the fronts of the caller's own offer while the report is open (decision 211)
 *     tags: [HelpOffers]
 */
router.put('/:id/types', appAuthMiddleware, controller.updateTypes)

export default router
