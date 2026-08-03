import { Router } from 'express'
import { requireAdmin } from '@gateway/require-admin.middleware'
import * as controller from './risk-config.controller'

const router = Router()

/**
 * @swagger
 * /api/risk-config/{category}:
 *   put:
 *     summary: Set the RiskTier for a Category (admin-only, decision 46)
 *     tags: [RiskConfig]
 */
router.get('/', requireAdmin, controller.list)
router.put('/:category', requireAdmin, controller.update)

export default router
