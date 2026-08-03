import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { feeRuleUpdateDto } from '@modules/monetization-config/fee-rule.dto'
import { auditFromRequest } from '@shared/audit/admin-audit'
import * as service from '@modules/monetization-config/fee-rule.service'

export async function list(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.listFeeRules() })
  } catch (err) {
    handleError(res, err, 'monetization-config GET')
  }
}

export async function get(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.getFeeRule(req.params.category) })
  } catch (err) {
    handleError(res, err, 'monetization-config GET :category')
  }
}

export async function update(req: Request, res: Response) {
  const body = parseBody(feeRuleUpdateDto, req, res)
  if (body === null) return

  const category = req.params.category === 'global' ? null : req.params.category
  try {
    await service.setFeeRule(category, body.feePercent, body.paymentModeAllowed)
    auditFromRequest(req, 'update', 'fee_rule', req.params.category, body)
    res.status(200).json({ ok: true, data: { category: req.params.category, ...body } })
  } catch (err) {
    handleError(res, err, 'monetization-config PUT')
  }
}
