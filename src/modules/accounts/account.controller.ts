import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import {
  accountLoginDto,
  accountRegisterDto,
  refreshDto,
} from '@modules/accounts/account.dto'
import * as service from '@modules/accounts/account.service'

export async function register(req: Request, res: Response) {
  const body = parseBody(accountRegisterDto, req, res)
  if (body === null) return
  try {
    res.status(201).json({ ok: true, data: await service.registerWithPassword(body) })
  } catch (err) {
    handleError(res, err, 'app-auth register POST')
  }
}

export async function login(req: Request, res: Response) {
  const body = parseBody(accountLoginDto, req, res)
  if (body === null) return
  try {
    const session = await service.loginWithPassword(body.email, body.password, body.totpCode)
    res.status(200).json({ ok: true, data: session })
  } catch (err) {
    handleError(res, err, 'app-auth login POST')
  }
}

export async function refresh(req: Request, res: Response) {
  const body = parseBody(refreshDto, req, res)
  if (body === null) return
  try {
    res.status(200).json({ ok: true, data: await service.refreshSession(body.refreshToken) })
  } catch (err) {
    handleError(res, err, 'app-auth refresh POST')
  }
}

/** Sign out from every device — access tokens die within the cache TTL,
 *  refresh tokens immediately (decision 122). */
export async function signOutEverywhere(req: Request, res: Response) {
  try {
    await service.revokeAllSessions(req.appAccountId!)
    res.status(200).json({ ok: true, data: { revoked: true } })
  } catch (err) {
    handleError(res, err, 'app-auth sign-out POST')
  }
}
