import { Router } from 'express'
import * as controller from '@modules/reward/reward.controller'

/**
 * Reward — app plane (decisions 1/30/88/147), mounted under /app-reward
 * behind appAuthMiddleware in app.ts (every route here needs an identified
 * account — a monetary reward requires a payer the PSP can bill; decisions
 * 60/82 govern disclosure to OTHER parties, not the payer's own KYC).
 */
const router = Router()

/**
 * @swagger
 * /app-reward/{reportId}:
 *   post:
 *     summary: Offers a monetary reward on the reporter's own report, unreserved (decisions 1/88)
 *     tags: [Reward]
 *   get:
 *     summary: Current reward state — seal derives from the LIVE rail state (decision 85)
 *     tags: [Reward]
 * /app-reward/{reportId}/reserve:
 *   post:
 *     summary: Reserves the guarantee via Pix against a FIXED recipient set (decisions 88/147)
 *     tags: [Reward]
 */
router.post('/:id', controller.offer)
router.get('/:id', controller.state)
router.post('/:id/reserve', controller.reserve)

export default router
