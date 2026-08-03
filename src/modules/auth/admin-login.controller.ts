import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { adminLoginDto } from '@modules/auth/admin-login.dto'
import * as service from '@modules/auth/admin-login.service'

export async function login(req: Request, res: Response) {
  const body = parseBody(adminLoginDto, req, res)
  if (body === null) return

  try {
    const result = await service.authenticateAdmin(body.email, body.password, body.totpCode)
    if (result.kind === 'enroll') {
      // Decision 114: enrollment is mandatory — no full JWT before it.
      res.status(200).json({ twoFactorSetupRequired: true, enrollToken: result.enrollToken })
      return
    }
    res.status(200).json({ jwt: result.jwt })
  } catch (err) {
    handleError(res, err, 'auth/admin-login POST')
  }
}

/** Sliding renewal (decision 112) — authMiddleware already validated the
 *  token AND its session_version before this runs. */
export async function renew(req: Request, res: Response) {
  try {
    const jwt = await service.renewSession(req.user!.userId)
    res.status(200).json({ jwt })
  } catch (err) {
    handleError(res, err, 'api/auth/renew POST')
  }
}
