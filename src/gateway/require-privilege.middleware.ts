import { NextFunction, Request, Response } from 'express'
import { userHasPrivilege } from '@shared/acl/privilege-store'
import { InterfaceKey, Privilege, Privileges } from '@shared/acl/privileges'
import { ErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * Per-endpoint privilege enforcement (decision 72) — replaces the binary
 * require-admin.middleware.ts. Conscious divergence from setes-api, where
 * tb_user_has_privilege only filters the menu and the API trusts the client:
 * in a public-safety product the API is the authority.
 *
 * Runs after authMiddleware (req.user populated). No role shortcut: there is
 * no super user (decision 70) — the Admin is simply a user holding grants on
 * the administration screens.
 */
const METHOD_PRIVILEGE: Record<string, Privilege> = {
  GET: Privileges.VIEW,
  POST: Privileges.INSERT,
  PUT: Privileges.UPDATE,
  PATCH: Privileges.UPDATE,
  DELETE: Privileges.DELETE,
}

export function requirePrivilege(interfaceKey: InterfaceKey, privilege?: Privilege) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const required = privilege ?? METHOD_PRIVILEGE[req.method]
    if (!required || !req.user) {
      res.status(403).json({ error: 'Forbidden', code: ErrorCodes.FORBIDDEN })
      return
    }

    try {
      const granted = await userHasPrivilege(req.user.userId, interfaceKey, required)
      if (!granted) {
        res.status(403).json({ error: 'Forbidden', code: ErrorCodes.FORBIDDEN })
        return
      }
      next()
    } catch (err) {
      // Fail closed: if the ACL lookup itself breaks, nobody gets through.
      logger.error('Privilege check failed', { err, interfaceKey, required })
      res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
    }
  }
}
