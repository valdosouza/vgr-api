import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { privilegeSaveDto } from '@modules/privileges/privilege.dto'
import * as service from '@modules/privileges/privilege.service'

export async function list(req: Request, res: Response) {
  try {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined
    res.status(200).json({ ok: true, data: await service.listPrivileges(filter) })
  } catch (err) {
    handleError(res, err, 'privileges GET')
  }
}

export async function get(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.getPrivilege(id) })
  } catch (err) {
    handleError(res, err, 'privileges GET :id')
  }
}

export async function create(req: Request, res: Response) {
  const body = parseBody(privilegeSaveDto, req, res)
  if (body === null) return
  try {
    res.status(201).json({ ok: true, data: await service.createPrivilege(body.description) })
  } catch (err) {
    handleError(res, err, 'privileges POST')
  }
}

export async function update(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  const body = parseBody(privilegeSaveDto, req, res)
  if (body === null) return
  try {
    res.status(200).json({ ok: true, data: await service.updatePrivilege(id, body.description) })
  } catch (err) {
    handleError(res, err, 'privileges PUT')
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    await service.deletePrivilege(id)
    res.status(200).json({ ok: true, data: { id } })
  } catch (err) {
    handleError(res, err, 'privileges DELETE')
  }
}
