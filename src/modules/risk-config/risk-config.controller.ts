import { Request, Response } from 'express'
import { handleError, parseBody } from '@shared/http/controller-utils'
import { riskTierConfigUpdateDto } from './risk-config.dto'
import { listRiskTierConfigs, setRiskTier } from './risk-config.service'

export async function list(req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await listRiskTierConfigs() })
  } catch (err) {
    handleError(res, err, 'risk-config GET')
  }
}

export async function update(req: Request, res: Response) {
  const body = parseBody(riskTierConfigUpdateDto, req, res)
  if (body === null) return

  const category = req.params.category
  try {
    await setRiskTier(category, body.tier)
    res.status(200).json({ ok: true, data: { category, tier: body.tier } })
  } catch (err) {
    handleError(res, err, 'risk-config PUT')
  }
}
