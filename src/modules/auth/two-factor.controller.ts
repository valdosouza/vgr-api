import { Request, Response } from 'express'
import { z } from 'zod'
import { handleError, parseBody } from '@shared/http/controller-utils'
import * as service from '@modules/auth/two-factor.service'

const setupDto = z.object({ enrollToken: z.string().min(10) })
const activateDto = z.object({
  enrollToken: z.string().min(10),
  code: z.string().regex(/^\d{6}$/, 'Must be the 6-digit code'),
})
const recoverDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  recoveryCode: z.string().min(8).max(16),
})

export async function setup(req: Request, res: Response) {
  const body = parseBody(setupDto, req, res)
  if (body === null) return
  try {
    res.status(200).json({ ok: true, data: await service.startEnrollment(body.enrollToken) })
  } catch (err) {
    handleError(res, err, 'auth/2fa/setup POST')
  }
}

export async function activate(req: Request, res: Response) {
  const body = parseBody(activateDto, req, res)
  if (body === null) return
  try {
    const data = await service.activateEnrollment(body.enrollToken, body.code)
    res.status(200).json({ ok: true, data })
  } catch (err) {
    handleError(res, err, 'auth/2fa/activate POST')
  }
}

export async function recover(req: Request, res: Response) {
  const body = parseBody(recoverDto, req, res)
  if (body === null) return
  try {
    const data = await service.recoverWithCode(body.email, body.password, body.recoveryCode)
    res.status(200).json({ ok: true, data })
  } catch (err) {
    handleError(res, err, 'auth/2fa/recover POST')
  }
}
