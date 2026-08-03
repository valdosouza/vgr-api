import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from './responder-pool.controller'

const router = Router()

/**
 * @swagger
 * /api/panic/responder-pool/{id}/resolve:
 *   put:
 *     summary: Approve or deny a pending Authorized Responder request (admin-only, decisions 51-52)
 *     tags: [ResponderPool]
 */
// POST stays unguarded: it's the mobile user requesting to become a
// responder (decision 51), not a team action.
router.post('/', controller.create)
router.get('/', requirePrivilege(InterfaceKeys.PANIC_RESPONDERS), controller.list)
router.put('/:id/resolve', requirePrivilege(InterfaceKeys.PANIC_RESPONDERS, Privileges.UPDATE), controller.resolve)

export default router
