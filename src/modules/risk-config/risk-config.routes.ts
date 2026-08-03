import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './risk-config.controller'

const router = Router()

/**
 * @swagger
 * /api/risk-config/{category}:
 *   put:
 *     summary: Set the RiskTier for a Category (admin-only, decision 46)
 *     tags: [RiskConfig]
 */
router.get('/', requirePrivilege(InterfaceKeys.RISK_CONFIG), controller.list)
router.put('/:category', requirePrivilege(InterfaceKeys.RISK_CONFIG), controller.update)

export default router
