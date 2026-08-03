import { Router } from 'express'
import categoryFormsRoutes from '@modules/risk-config/category-form-schema.routes'
import riskConfigRoutes from '@modules/risk-config/risk-config.routes'
import responderPoolRoutes from '@modules/panic/responder-pool.routes'
import dualControlAccessRoutes from '@modules/admin-access/dual-control.routes'
import monetizationConfigRoutes from '@modules/monetization-config/fee-rule.routes'

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

export default router
