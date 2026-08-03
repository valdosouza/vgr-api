import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { adminLoginDto } from '@modules/auth/admin-login.dto'
import * as service from '@modules/auth/admin-login.service'

export async function login(req: Request, res: Response) {
  const body = parseBody(adminLoginDto, req, res)
  if (body === null) return

  try {
    const jwt = await service.authenticateAdmin(body.email, body.password)
    res.status(200).json({ jwt })
  } catch (err) {
    handleError(res, err, 'auth/admin-login POST')
  }
}
