import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { userCreateDto, userPrivilegesSyncDto, userUpdateDto } from '@modules/users/user.dto'
import * as service from '@modules/users/user.service'
import { ErrorCodes } from '@shared/errors/error-codes'
import { auditFromRequest } from '@shared/audit/admin-audit'

export async function list(req: Request, res: Response) {
  try {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined
    res.status(200).json({ ok: true, data: await service.listUsers(filter) })
  } catch (err) {
    handleError(res, err, 'users GET')
  }
}

export async function get(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.getUser(id) })
  } catch (err) {
    handleError(res, err, 'users GET :id')
  }
}

export async function create(req: Request, res: Response) {
  const body = parseBody(userCreateDto, req, res)
  if (body === null) return
  try {
    const created = await service.createUser(body)
    auditFromRequest(req, 'create', 'user', created.id, body)
    res.status(201).json({ ok: true, data: created })
  } catch (err) {
    handleError(res, err, 'users POST')
  }
}

export async function update(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  const body = parseBody(userUpdateDto, req, res)
  if (body === null) return
  try {
    const updated = await service.updateUser(id, body)
    auditFromRequest(req, 'update', 'user', id, body)
    res.status(200).json({ ok: true, data: updated })
  } catch (err) {
    handleError(res, err, 'users PUT')
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    await service.deleteUser(id, req.user!.userId)
    auditFromRequest(req, 'delete', 'user', id)
    res.status(200).json({ ok: true, data: { id } })
  } catch (err) {
    handleError(res, err, 'users DELETE')
  }
}

export async function resetTwoFactor(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    await service.resetTwoFactor(id, req.user!.userId)
    auditFromRequest(req, 'update', 'user_2fa_reset', id)
    res.status(200).json({ ok: true, data: { id } })
  } catch (err) {
    handleError(res, err, 'users POST :id/2fa/reset')
  }
}

export async function privileges(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.getUserPrivilegeMatrix(id) })
  } catch (err) {
    handleError(res, err, 'users GET :id/privileges')
  }
}

export async function syncPrivileges(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return

  const interfaceId = Number(req.params.interfaceId)
  if (!Number.isInteger(interfaceId) || interfaceId < 0) {
    res.status(400).json({ error: 'Invalid id', code: ErrorCodes.INVALID_ID })
    return
  }

  const body = parseBody(userPrivilegesSyncDto, req, res)
  if (body === null) return
  try {
    await service.syncUserPrivileges(id, interfaceId, body.privilegeIds, req.user!.userId)
    // The one that motivated decision 116: granting access finally leaves
    // a record of who granted it.
    auditFromRequest(req, 'grant', 'user_privileges', id, {
      interfaceId,
      privilegeIds: body.privilegeIds,
    })
    res.status(200).json({ ok: true, data: { userId: id, interfaceId } })
  } catch (err) {
    handleError(res, err, 'users PUT :id/privileges/:interfaceId')
  }
}
