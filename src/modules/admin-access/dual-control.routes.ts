import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from './dual-control.controller'

const router = Router()

/**
 * @swagger
 * /api/dual-control-access:
 *   post:
 *     summary: Open a decryption request (decision 45) — the session user is the requester and its first authorization
 *     tags: [DualControlAccess]
 *   get:
 *     summary: List requests, newest first; page/pageSize/filter on the legal basis (decisions 220/227)
 *     tags: [DualControlAccess]
 * /api/dual-control-access/{id}/approvals:
 *   post:
 *     summary: Approve as the session user — must differ from the requester; one approval grants (decision 224)
 *     tags: [DualControlAccess]
 */
// Per-privilege enforcement (decision 72): POST / is INSERT, GET / is VIEW.
router.post('/', requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS), controller.create)
router.get('/', requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS), controller.list)
// Layered guards (decisions 45/93): approving is an UPDATE on the request
// even though the verb is POST, and also needs the approver kind-'R'
// resource. The approver is the session user, never a body field (223).
router.post(
  '/:id/approvals',
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS, Privileges.UPDATE),
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_APPROVAL, Privileges.UPDATE),
  controller.approve
)

export default router
