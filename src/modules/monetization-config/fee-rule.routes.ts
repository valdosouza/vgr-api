import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './fee-rule.controller'

const router = Router()

/**
 * @swagger
 * /api/monetization-config/{category}:
 *   put:
 *     summary: Set the fee rule for a Category, or the global default via category="global" (admin-only, decisions 39/58)
 *     tags: [MonetizationConfig]
 */
router.get('/', requirePrivilege(InterfaceKeys.MONETIZATION_CONFIG), controller.list)
router.get('/:category', requirePrivilege(InterfaceKeys.MONETIZATION_CONFIG), controller.get)
router.put('/:category', requirePrivilege(InterfaceKeys.MONETIZATION_CONFIG), controller.update)

export default router
