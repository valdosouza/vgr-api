import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { preferencesUpdateDto } from '@modules/core/core.dto'
import * as service from '@modules/core/core.service'

export async function menus(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.getMenus(req.user!.userId) })
  } catch (err) {
    handleError(res, err, 'core GET menus')
  }
}

export async function permissions(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.getPermissions(req.user!.userId) })
  } catch (err) {
    handleError(res, err, 'core GET permissions')
  }
}

export async function me(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.getMe(req.user!.userId) })
  } catch (err) {
    handleError(res, err, 'core GET me')
  }
}

export async function savePreferences(req: Request, res: Response) {
  const body = parseBody(preferencesUpdateDto, req, res)
  if (body === null) return
  try {
    res.status(200).json({ ok: true, data: await service.savePreferences(req.user!.userId, body.locale) })
  } catch (err) {
    handleError(res, err, 'core PUT preferences')
  }
}
