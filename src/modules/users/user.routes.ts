import { Router } from 'express'
import { requirePrivilege } from '@gateway/require-privilege.middleware'
import { InterfaceKeys, Privileges } from '@shared/acl/privileges'
import * as controller from './user.controller'

const router = Router()

/**
 * @swagger
 * /api/users/{id}/privileges/{interfaceId}:
 *   put:
 *     summary: Grant the listed privileges on one screen and revoke the rest (decisions 70-72; granting anything implies VIEW)
 *     tags: [Users]
 */
router.use(requirePrivilege(InterfaceKeys.USERS))
router.get('/', controller.list)
router.get('/:id', controller.get)
router.post('/', controller.create)
router.put('/:id', controller.update)
router.delete('/:id', controller.remove)
// Layered guards (decision 93): the router-level USERS guard runs first,
// then the kind-'R' resource — seeing the matrix needs users.VIEW AND
// user_privileges.VIEW; granting needs users.UPDATE AND
// user_privileges.UPDATE. Revoking user_privileges from someone removes
// their granting power while keeping their user-data editing.
router.get('/:id/privileges', requirePrivilege(InterfaceKeys.USER_PRIVILEGES, Privileges.VIEW), controller.privileges)
router.put('/:id/privileges/:interfaceId', requirePrivilege(InterfaceKeys.USER_PRIVILEGES, Privileges.UPDATE), controller.syncPrivileges)

export default router
