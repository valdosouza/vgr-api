import { Router } from 'express'
import { optionalAppAuth } from '@gateway/optional-app-auth.middleware'
import * as controller from '@modules/help-offers/help-offers.controller'

/**
 * Help offers (spec tasks 06/07, decisions 10/20/34/35), mounted under
 * /app-help-offers — app plane. Anonymous offers are a product promise
 * (35): without a reward involved, anonymous help is accepted in full;
 * the anonymous helper is told in the app they cannot claim a reward (34).
 */
const router = Router()

/**
 * @swagger
 * /app-help-offers:
 *   post:
 *     summary: Offers help on an open report; self-dealing rejected (decisions 10/20/34/35)
 *     security: []
 *     tags: [HelpOffers]
 */
router.post('/', optionalAppAuth, controller.submit)

export default router
