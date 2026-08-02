import { Router } from 'express'

/**
 * Central router — every module is mounted here at /api/<module>,
 * mirroring 1:1 the equivalent module in the app (see
 * D:\ProjetoVGR\api\docs\adr\ARCHITECTURE.md — symmetry with setes-app/setes-api).
 *
 * Example (once the first module exists, e.g. `reports`):
 *   import reportsRoutes from '@modules/reports/reports.routes'
 *   router.use('/reports', reportsRoutes)
 *
 * REQUIRED: a module never imports another module — shared dependencies
 * go to `@shared/*`.
 */
const router = Router()

export default router
