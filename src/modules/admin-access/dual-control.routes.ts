import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from './dual-control.controller'

const router = Router()

/**
 * @swagger
 * /api/dual-control-access/{id}/approvals:
 *   post:
 *     summary: Record one admin's approval toward the 2-distinct-approver decryption gate (decision 45)
 *     tags: [DualControlAccess]
 */
// Per-privilege enforcement (decision 72). Approving is an UPDATE on the
// request even though the route verb is POST, so the privilege is explicit.
router.post('/', requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS), controller.create)
router.get('/', requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS), controller.list)
// Layered guards (decisions 45/93): approving needs the screen's UPDATE AND
// the approver kind-'R' resource — requesters and approvers can be
// different people, strengthening the 2-distinct-approver gate.
router.post(
  '/:id/approvals',
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_ACCESS, Privileges.UPDATE),
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_APPROVAL, Privileges.UPDATE),
  controller.approve
)

export default router
