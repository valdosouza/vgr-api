import { Router } from 'express'
import * as controller from '@modules/help-matching/help-matching.controller'

/**
 * Nearby-reports feed (spec task 05, decisions 2/7/21/135), mounted under
 * /app-feed — app plane. Deliberately UNAUTHENTICATED: viewing nearby
 * reports never requires an account (success criterion 2, decisions
 * 32/35), and what leaves here is already degraded by tier (135): grid
 * position, stepped distance, rounded time, no reporter, no engagement.
 */
const router = Router()

/**
 * @swagger
 * /app-feed:
 *   get:
 *     summary: Paginated nearby-reports feed, recency or relevance order; tier-degraded output (decisions 7/21/135)
 *     security: []
 *     tags: [Reports]
 */
router.get('/', controller.feed)

export default router
