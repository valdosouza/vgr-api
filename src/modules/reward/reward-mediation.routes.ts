import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from '@modules/reward/reward.controller'

/**
 * Reward mediation — panel plane (decisions 98/148/149/150), mounted under
 * /api/reward-mediation. Full discipline: criteria published before the
 * case, propose -> approve by a DIFFERENT mediator -> contest window ->
 * execute at the rail; every step in the append-only mediation log.
 */
const router = Router()

/**
 * @swagger
 * /api/reward-mediation/criteria:
 *   post:
 *     summary: Publishes an immutable criteria version — the one active at reserve time governs the case (decision 150)
 *     tags: [RewardMediation]
 * /api/reward-mediation/{reportId}:
 *   get:
 *     summary: Live resolution, open contests and the immutable trail for the case's reward (report and offer are 1:1)
 *     tags: [RewardMediation]
 * /api/reward-mediation/{reportId}/propose:
 *   post:
 *     summary: Mediator A proposes the outcome, judged by the stamped criteria version (decision 148)
 *     tags: [RewardMediation]
 * /api/reward-mediation/{reportId}/approve:
 *   post:
 *     summary: A DIFFERENT mediator approves — opens the contest window, does not touch the rail (decisions 148/149)
 *     tags: [RewardMediation]
 * /api/reward-mediation/{reportId}/cancel:
 *   post:
 *     summary: Abandons the live proposal so a new cycle can start
 *     tags: [RewardMediation]
 * /api/reward-mediation/{reportId}/execute:
 *   post:
 *     summary: Window elapsed and no open contest — capture releases to the fixed set, cancel refunds the payer (decisions 100/149)
 *     tags: [RewardMediation]
 * /api/reward-mediation/contests/{contestId}/close:
 *   post:
 *     summary: Closes a contest with a note recorded in the immutable trail (decision 149)
 *     tags: [RewardMediation]
 */
router.post(
  '/criteria',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.publishCriteria
)
router.post(
  '/contests/:id/close',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.closeContest
)
router.get(
  '/:id',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.VIEW),
  controller.mediationState
)
router.post(
  '/:id/propose',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.propose
)
router.post(
  '/:id/approve',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.approve
)
router.post(
  '/:id/cancel',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.cancel
)
router.post(
  '/:id/execute',
  requirePrivilege(InterfaceKeys.REWARD_MEDIATION, Privileges.UPDATE),
  controller.execute
)

export default router
