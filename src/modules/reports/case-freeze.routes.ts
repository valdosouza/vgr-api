import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/reports/case-freeze.controller'

/**
 * Case freeze (decisions 141/142) — mounted under /api/case-freeze,
 * panel plane. The ONE panel surface this front adds: look a case up,
 * freeze with a mandatory reason, request/approve unfreeze. The
 * request-vs-approve separation (distinct users) is enforced in the
 * service — unfreezing re-arms destruction (dual-control, 45/107).
 */
const router = Router()

/**
 * @swagger
 * /api/case-freeze/{id}:
 *   get:
 *     summary: Case retention state for the freeze screen (decision 142)
 *     tags: [CaseFreeze]
 * /api/case-freeze/{id}/freeze:
 *   post:
 *     summary: Freezes the whole case with a mandatory reason (decision 141)
 *     tags: [CaseFreeze]
 * /api/case-freeze/{id}/unfreeze-request:
 *   post:
 *     summary: Requests unfreeze (step 1 of dual control, decision 141d)
 *     tags: [CaseFreeze]
 * /api/case-freeze/{id}/unfreeze-approve:
 *   post:
 *     summary: Approves unfreeze — must be a different user; retention restarts (decision 141d)
 *     tags: [CaseFreeze]
 */
router.get('/:id', requirePrivilege(InterfaceKeys.CASE_FREEZE, Privileges.VIEW), controller.state)
router.post(
  '/:id/freeze',
  requirePrivilege(InterfaceKeys.CASE_FREEZE, Privileges.UPDATE),
  controller.freeze
)
router.post(
  '/:id/unfreeze-request',
  requirePrivilege(InterfaceKeys.CASE_FREEZE, Privileges.UPDATE),
  controller.requestUnfreeze
)
router.post(
  '/:id/unfreeze-approve',
  requirePrivilege(InterfaceKeys.CASE_FREEZE, Privileges.UPDATE),
  controller.approveUnfreeze
)

export default router
