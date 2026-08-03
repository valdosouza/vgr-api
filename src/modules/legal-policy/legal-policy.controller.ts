import { Request, Response } from 'express'
import { handleError, parseBody, parseId } from '@shared/http/controller-utils'
import { jurisdictionStateDto, legalRuleProposalDto } from '@modules/legal-policy/legal-policy.dto'
import * as service from '@modules/legal-policy/legal-policy.service'
import { auditFromRequest } from '@shared/audit/admin-audit'

function actorId(req: Request): number {
  // authMiddleware guarantees req.user on /api routes; guards run before us.
  return req.user!.userId
}

// ---------------------------------------------------------------- rules

export async function listRules(req: Request, res: Response) {
  try {
    const filter = {
      capability: typeof req.query.capability === 'string' ? req.query.capability : undefined,
      jurisdictionCode:
        typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction : undefined,
    }
    res.status(200).json({ ok: true, data: await service.listRules(filter) })
  } catch (err) {
    handleError(res, err, 'legal-policy rules GET')
  }
}

export async function proposeRule(req: Request, res: Response) {
  const body = parseBody(legalRuleProposalDto, req, res)
  if (body === null) return
  try {
    res.status(201).json({ ok: true, data: await service.proposeRule(body, actorId(req)) })
  } catch (err) {
    handleError(res, err, 'legal-policy rules POST')
  }
}

export async function approveRule(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.approveRule(id, actorId(req)) })
  } catch (err) {
    handleError(res, err, 'legal-policy rules approve')
  }
}

export async function rejectRule(req: Request, res: Response) {
  const id = parseId(req, res)
  if (id === null) return
  try {
    res.status(200).json({ ok: true, data: await service.rejectRule(id, actorId(req)) })
  } catch (err) {
    handleError(res, err, 'legal-policy rules reject')
  }
}

// -------------------------------------------------------- jurisdictions

export async function listJurisdictions(_req: Request, res: Response) {
  try {
    res.status(200).json({ ok: true, data: await service.listJurisdictions() })
  } catch (err) {
    handleError(res, err, 'legal-policy jurisdictions GET')
  }
}

export async function requestState(req: Request, res: Response) {
  const body = parseBody(jurisdictionStateDto, req, res)
  if (body === null) return
  try {
    const data = await service.requestOperationalState(req.params.code, body.state, actorId(req))
    auditFromRequest(req, 'state_change', 'jurisdiction', req.params.code, body)
    res.status(200).json({ ok: true, data })
  } catch (err) {
    handleError(res, err, 'legal-policy jurisdictions state PUT')
  }
}

export async function confirmState(req: Request, res: Response) {
  try {
    const data = await service.confirmOperationalState(req.params.code, actorId(req))
    auditFromRequest(req, 'state_change', 'jurisdiction', req.params.code, { confirmed: true })
    res.status(200).json({ ok: true, data })
  } catch (err) {
    handleError(res, err, 'legal-policy jurisdictions state confirm')
  }
}

// --------------------------------------------------------- capabilities

export async function listCapabilities(req: Request, res: Response) {
  try {
    const jurisdiction =
      typeof req.query.jurisdiction === 'string' && req.query.jurisdiction
        ? req.query.jurisdiction
        : null
    if (!jurisdiction) {
      res.status(422).json({
        error: 'jurisdiction query parameter is required',
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'jurisdiction', message: 'Required', code: 'REQUIRED' }],
      })
      return
    }
    res.status(200).json({ ok: true, data: await service.listCapabilities(jurisdiction) })
  } catch (err) {
    handleError(res, err, 'legal-policy capabilities GET')
  }
}
