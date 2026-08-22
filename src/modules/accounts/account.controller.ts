import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import {
  accountLoginDto,
  accountRegisterDto,
  confirmEmailVerificationDto,
  providerLoginDto,
  refreshDto,
} from '@modules/accounts/account.dto'
import * as service from '@modules/accounts/account.service'
import { verifyProviderToken } from '@shared/auth/social-verifier'

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

/** The client sends the provider's raw token; this is the only place it is
 *  ever accepted un-verified — `verifyProviderToken` checks it against the
 *  provider (JWKS) before the domain ever sees an identity (decision 119). */
export async function loginWithProvider(req: Request, res: Response) {
  const body = parseBody(providerLoginDto, req, res)
  if (body === null) return
  try {
    const identity = await verifyProviderToken(body.provider, body.idToken)
    const session = await service.loginWithProvider(identity)
    res.status(200).json({ ok: true, data: session })
  } catch (err) {
    handleError(res, err, 'app-auth login-provider POST')
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

/** Always 200 — never reveals whether an email was already verified or
 *  absent (decision 151). */
export async function sendEmailVerification(req: Request, res: Response) {
  try {
    await service.sendEmailVerification(req.appAccountId!)
    res.status(200).json({ ok: true, data: { sent: true } })
  } catch (err) {
    handleError(res, err, 'app-auth verify-email/send POST')
  }
}

export async function confirmEmailVerification(req: Request, res: Response) {
  const body = parseBody(confirmEmailVerificationDto, req, res)
  if (body === null) return
  try {
    await service.confirmEmailVerification(req.appAccountId!, body.code)
    res.status(200).json({ ok: true, data: { verified: true } })
  } catch (err) {
    handleError(res, err, 'app-auth verify-email/confirm POST')
  }
}
