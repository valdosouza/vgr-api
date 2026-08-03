import { Router } from 'express'
import { requireAdmin } from '@gateway/require-admin.middleware'
import * as controller from './fee-rule.controller'

const router = Router()

/**
 * @swagger
 * /api/monetization-config/{category}:
 *   put:
 *     summary: Set the fee rule for a Category, or the global default via category="global" (admin-only, decisions 39/58)
 *     tags: [MonetizationConfig]
 */
router.get('/', requireAdmin, controller.list)
router.get('/:category', requireAdmin, controller.get)
router.put('/:category', requireAdmin, controller.update)

export default router
