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
 * /app-reward/onboarding:
 *   post:
 *     summary: Onboards the helper as a payout recipient — KYC goes to the rail, only the opaque id is stored (decision 143)
 *     tags: [Reward]
 *   get:
 *     summary: Whether this account can already be targeted by a reserve
 *     tags: [Reward]
 * /app-reward/mediation-criteria:
 *   get:
 *     summary: The active mediation criteria — the rules of the game, published before the case (decision 150)
 *     tags: [Reward]
 * /app-reward/{reportId}/contest:
 *   post:
 *     summary: A case party contests the resolution while the money is still retained (decision 149)
 *     tags: [Reward]
 */
// Static routes first — '/:id' would otherwise swallow them.
router.post('/onboarding', controller.onboard)
router.get('/onboarding', controller.onboardingStatus)
router.get('/mediation-criteria', controller.activeCriteria)
router.post('/:id/contest', controller.contest)
router.post('/:id', controller.offer)
router.get('/:id', controller.state)
router.post('/:id/reserve', controller.reserve)

export default router
