import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { interfaceSaveDto } from '@modules/interfaces/interface.dto'
import { auditFromRequest } from '@shared/audit/admin-audit'
import * as service from '@modules/interfaces/interface.service'

export async function list(req: Request, res: Response) {
  try {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined
    res.status(200).json({ ok: true, data: await service.listInterfaces(filter) })
  } catch (err) {
    handleError(res, err, 'interfaces GET')
  }
}

export async function get(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.getInterface(id) })
  } catch (err) {
    handleError(res, err, 'interfaces GET :id')
  }
}

export async function create(req: Request, res: Response) {
  const body = parseBody(interfaceSaveDto, req, res)
  if (body === null) return
  try {
    const created = await service.createInterface(body)
    auditFromRequest(req, 'create', 'interface', created.id, body)
    res.status(201).json({ ok: true, data: created })
  } catch (err) {
    handleError(res, err, 'interfaces POST')
  }
}

export async function update(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  const body = parseBody(interfaceSaveDto, req, res)
  if (body === null) return
  try {
    const updated = await service.updateInterface(id, body)
    auditFromRequest(req, 'update', 'interface', id, body)
    res.status(200).json({ ok: true, data: updated })
  } catch (err) {
    handleError(res, err, 'interfaces PUT')
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    await service.deleteInterface(id)
    auditFromRequest(req, 'delete', 'interface', id)
    res.status(200).json({ ok: true, data: { id } })
  } catch (err) {
    handleError(res, err, 'interfaces DELETE')
  }
}
