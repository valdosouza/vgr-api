import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { categoryFormSchemaUpdateDto } from './category-form-schema.dto'
import { listCategoryFormSchemas, setCategoryFormSchema } from './category-form-schema.service'
import { auditFromRequest } from '@shared/audit/admin-audit'

export async function list(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await listCategoryFormSchemas() })
  } catch (err) {
    handleError(res, err, 'category-forms GET')
  }
}

export async function update(req: Request, res: Response) {
  const body = parseBody(categoryFormSchemaUpdateDto, req, res)
  if (body === null) return

  const category = req.params.category
  try {
    await setCategoryFormSchema(category, body.fields)
    auditFromRequest(req, 'update', 'category_form', category, body)
    res.status(200).json({ ok: true, data: { category, fields: body.fields } })
  } catch (err) {
    handleError(res, err, 'category-forms PUT')
  }
}
