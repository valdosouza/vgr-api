import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/reward/reward.controller'

/**
 * Reward mediation — panel plane (decisions 98/147), mounted under
 * /api/reward-mediation. Judges fulfillment for the recipient set already
 * fixed at reserve time; does not choose recipients (that would need
 * PENDING criteria publication / dual control per decision 98's full
 * discipline — not built in this slice, see reward.md).
 */
const router = Router()

/**
 * @swagger
 * /api/reward-mediation/{id}/resolve:
 *   post:
 *     summary: Judges condition fulfillment — capture releases to the fixed set, refund returns to the payer (decisions 98/100/147)
 *     tags: [RewardMediation]
 */
router.post(
  '/:id/resolve',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.resolve
)

export default router
