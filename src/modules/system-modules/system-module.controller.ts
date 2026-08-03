import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { systemModuleSaveDto } from '@modules/system-modules/system-module.dto'
import { auditFromRequest } from '@shared/audit/admin-audit'
import * as service from '@modules/system-modules/system-module.service'

export async function list(req: Request, res: Response) {
  try {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined
    res.status(200).json({ ok: true, data: await service.listSystemModules(filter) })
  } catch (err) {
    handleError(res, err, 'system-modules GET')
  }
}

export async function get(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.getSystemModule(id) })
  } catch (err) {
    handleError(res, err, 'system-modules GET :id')
  }
}

export async function create(req: Request, res: Response) {
  const body = parseBody(systemModuleSaveDto, req, res)
  if (body === null) return
  try {
    const created = await service.createSystemModule(body)
    auditFromRequest(req, 'create', 'system_module', created.id, body)
    res.status(201).json({ ok: true, data: created })
  } catch (err) {
    handleError(res, err, 'system-modules POST')
  }
}

export async function update(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  const body = parseBody(systemModuleSaveDto, req, res)
  if (body === null) return
  try {
    const updated = await service.updateSystemModule(id, body)
    auditFromRequest(req, 'update', 'system_module', id, body)
    res.status(200).json({ ok: true, data: updated })
  } catch (err) {
    handleError(res, err, 'system-modules PUT')
  }
}

export async function remove(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    await service.deleteSystemModule(id)
    auditFromRequest(req, 'delete', 'system_module', id)
    res.status(200).json({ ok: true, data: { id } })
  } catch (err) {
    handleError(res, err, 'system-modules DELETE')
  }
}
