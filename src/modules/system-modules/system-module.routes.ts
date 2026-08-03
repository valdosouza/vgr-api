import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys } from '@shared/acl/privileges'
import * as controller from './system-module.controller'

const router = Router()

/**
 * @swagger
 * /api/system-modules:
 *   get:
 *     summary: List menu modules with their ordered screens (decision 71 — CRUD that setes never had)
 *     tags: [SystemModules]
 */
router.use(requirePrivilege(InterfaceKeys.SYSTEM_MODULES))
router.get('/', controller.list)
router.get('/:id', controller.get)
router.post('/', controller.create)
router.put('/:id', controller.update)
router.delete('/:id', controller.remove)

export default router
