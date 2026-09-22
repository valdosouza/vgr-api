import { Request, Response } from 'express'
import { handleError, parseBody, parseId, parseQuery } from '@shared/http/controller-utils'
import {
  capabilityListQueryDto,
  jurisdictionListQueryDto,
  jurisdictionStateDto,
  legalRuleProposalDto,
  ruleListQueryDto,
} from '@modules/legal-policy/legal-policy.dto'
import * as service from '@modules/legal-policy/legal-policy.service'
import { auditFromRequest } from '@shared/audit/admin-audit'

function actorId(req: Request): number {
  // authMiddleware guarantees req.user on /api routes; guards run before us.
  return req.user!.userId
}

// ---------------------------------------------------------------- rules

export async function listRules(req: Request, res: Response) {
  const query = parseQuery(ruleListQueryDto, req, res)
  if (query === null) return
  try {
    res.status(200).json({ ok: true, data: await service.listRules(query) })
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

export async function listJurisdictions(req: Request, res: Response) {
  const query = parseQuery(jurisdictionListQueryDto, req, res)
  if (query === null) return
  try {
    res.status(200).json({ ok: true, data: await service.listJurisdictions(query) })
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

/** `jurisdiction` is mandatory: a missing one is the same 422 REQUIRED
 *  envelope as before (now emitted by parseQuery, decision 83). */
export async function listCapabilities(req: Request, res: Response) {
  const query = parseQuery(capabilityListQueryDto, req, res)
  if (query === null) return
  try {
    const { jurisdiction, ...paging } = query
    res.status(200).json({ ok: true, data: await service.listCapabilities(jurisdiction, paging) })
  } catch (err) {
    handleError(res, err, 'legal-policy capabilities GET')
  }
}
