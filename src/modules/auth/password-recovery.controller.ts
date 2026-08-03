import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { changePasswordDto, recoveryPasswordDto } from '@modules/auth/password-recovery.dto'
import * as service from '@modules/auth/password-recovery.service'

export async function recovery(req: Request, res: Response) {
  const body = parseBody(recoveryPasswordDto, req, res)
  if (body === null) return
  try {
    await service.recoveryPassword(body.email)
    // Always the same body — no user enumeration.
    res.status(200).json({ ok: true, data: { sent: true } })
  } catch (err) {
    handleError(res, err, 'auth/recovery-password POST')
  }
}

export async function change(req: Request, res: Response) {
  const body = parseBody(changePasswordDto, req, res)
  if (body === null) return
  try {
    await service.changePassword(body.email, body.code, body.newPassword)
    res.status(200).json({ ok: true, data: { changed: true } })
  } catch (err) {
    handleError(res, err, 'auth/change-password POST')
  }
}
