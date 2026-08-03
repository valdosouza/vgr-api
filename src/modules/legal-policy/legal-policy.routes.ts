import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/legal-policy/legal-policy.controller'

const router = Router()

/**
 * @swagger
 * /api/legal-policy/jurisdictions:
 *   get:
 *     summary: List jurisdictions with operational state (Legal Gate — decisions 76, 107)
 *     tags: [LegalPolicy]
 */
router.get(
  '/jurisdictions',
  requirePrivilege(InterfaceKeys.LEGAL_JURISDICTIONS),
  controller.listJurisdictions
)

// Kill switch (decision 107): tightening applies immediately with ONE
// UPDATE holder; loosening only records a pending state.
router.put(
  '/jurisdictions/:code/state',
  requirePrivilege(InterfaceKeys.LEGAL_JURISDICTIONS, Privileges.UPDATE),
  controller.requestState
)

// Confirming a pending loosening is the approver act — layered guards
// (decision 93 mechanism): the screen's UPDATE and the dual-control
// approver resource, by a user distinct from the proposer (checked in the
// service).
router.post(
  '/jurisdictions/:code/state/confirm',
  requirePrivilege(InterfaceKeys.LEGAL_JURISDICTIONS, Privileges.UPDATE),
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_APPROVAL, Privileges.UPDATE),
  controller.confirmState
)

/**
 * @swagger
 * /api/legal-policy/capabilities:
 *   get:
 *     summary: Capability catalog with the current effective status per jurisdiction (decision 103)
 *     tags: [LegalPolicy]
 */
router.get(
  '/capabilities',
  requirePrivilege(InterfaceKeys.LEGAL_CAPABILITIES),
  controller.listCapabilities
)

/**
 * @swagger
 * /api/legal-policy/rules:
 *   get:
 *     summary: Rule history per capability x jurisdiction (versioned — plan §6)
 *     tags: [LegalPolicy]
 *   post:
 *     summary: Propose a rule (born 'proposed' — decision 107)
 *     tags: [LegalPolicy]
 */
router.get('/rules', requirePrivilege(InterfaceKeys.LEGAL_RULES), controller.listRules)
router.post(
  '/rules',
  requirePrivilege(InterfaceKeys.LEGAL_RULES, Privileges.INSERT),
  controller.proposeRule
)

// Approval activates the rule (supersedes the previous version) — layered
// guards, same pattern as the confirm endpoint above.
router.post(
  '/rules/:id/approve',
  requirePrivilege(InterfaceKeys.LEGAL_RULES, Privileges.UPDATE),
  requirePrivilege(InterfaceKeys.DUAL_CONTROL_APPROVAL, Privileges.UPDATE),
  controller.approveRule
)

router.post(
  '/rules/:id/reject',
  requirePrivilege(InterfaceKeys.LEGAL_RULES, Privileges.UPDATE),
  controller.rejectRule
)

export default router
