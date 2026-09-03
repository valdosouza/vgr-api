import { Router } from 'express'
import categoryFormsRoutes from '@modules/risk-config/category-form-schema.routes'
import riskConfigRoutes from '@modules/risk-config/risk-config.routes'
import responderPoolRoutes from '@modules/panic/responder-pool.routes'
import dualControlAccessRoutes from '@modules/admin-access/dual-control.routes'
import monetizationConfigRoutes from '@modules/monetization-config/fee-rule.routes'
import coreRoutes from '@modules/core/core.routes'
import legalPolicyRoutes from '@modules/legal-policy/legal-policy.routes'
import { renew } from '@modules/auth/admin-login.controller'
import privilegeRoutes from '@modules/privileges/privilege.routes'
import interfaceRoutes from '@modules/interfaces/interface.routes'
import systemModuleRoutes from '@modules/system-modules/system-module.routes'
import userRoutes from '@modules/users/user.routes'
import mediaAdminRoutes from '@modules/media/media-admin.routes'
import caseFreezeRoutes from '@modules/reports/case-freeze.routes'
import reportsAdminRoutes from '@modules/reports/reports-admin.routes'
import rewardMediationRoutes from '@modules/reward/reward-mediation.routes'
import adminAuditRoutes from '@modules/admin-audit/admin-audit.routes'

/**
 * Central router — every module is mounted here at /api/<module>,
 * mirroring 1:1 the equivalent module in the app (see
 * D:\ProjetoVGR\api\docs\adr\ARCHITECTURE.md — symmetry with setes-app/setes-api).
 *
 * REQUIRED: a module never imports another module — shared dependencies
 * go to `@shared/*`.
 */
const router = Router()

router.use('/risk-config', riskConfigRoutes)
router.use('/category-forms', categoryFormsRoutes)
router.use('/panic/responder-pool', responderPoolRoutes)
router.use('/dual-control-access', dualControlAccessRoutes)
router.use('/monetization-config', monetizationConfigRoutes)

// Access-control modules (decisions 68-75) + session/menu endpoints.
router.use('/core', coreRoutes)
router.use('/privileges', privilegeRoutes)
router.use('/interfaces', interfaceRoutes)
router.use('/system-modules', systemModuleRoutes)
router.use('/users', userRoutes)

// Sliding session renewal (decision 112) — behind authMiddleware like all
// of /api; any authenticated team user, no privilege needed.
router.post('/auth/renew', renew)

// Legal Gate administration (decisions 103-109) — the gate itself lives in
// @shared/legal and is consumed via requireCapability / assertCapability.
router.use('/legal-policy', legalPolicyRoutes)

// Panel reads of evidence media (M3, decisions 126-131) — every served
// image leaves an audit row; the EXIF original needs a second grant.
router.use('/media', mediaAdminRoutes)

// Case freeze (decisions 141/142) — freeze with 1, unfreeze with 2.
router.use('/case-freeze', caseFreezeRoutes)

// Report search + case detail on the panel plane (B1, decisions 159/166)
// — detail reads audited; the exact position needs a second grant.
router.use('/reports', reportsAdminRoutes)

// Reward mediation (decisions 98/147) — judges fulfillment for the
// recipient set fixed at reserve time (R0 first slice).
router.use('/reward-mediation', rewardMediationRoutes)

// Administrative trail READ (B5, decisions 116/165/166) — VIEW only, no
// write route ever; reading the trail is not audited.
router.use('/admin-audit', adminAuditRoutes)

export default router
