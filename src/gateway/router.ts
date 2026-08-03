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

export default router
