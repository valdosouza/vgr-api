import { NextFunction, Request, Response } from 'express'
import { checkCapability } from '@shared/legal/legal-gate'
import { Capability } from '@shared/legal/capabilities'
import { ErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * Legal Gate enforcement at the HTTP edge (decisions 76, 104) — the
 * companion of requirePrivilege: privilege answers "may THIS USER do it",
 * capability answers "may THIS INSTALLATION do it at all". Routes that
 * carry legal risk stack both.
 *
 * Blocked -> HTTP 451 (Unavailable For Legal Reasons) with the stable
 * LEGAL_BLOCKED code (decision 80 contract). Sandbox allows are marked
 * with the demo header on the response (decision 79) so no demonstration
 * output can be mistaken for a compliant production response.
 */
export function requireCapability(capability: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const decision = await checkCapability(capability, {
        userRef: req.user ? String(req.user.userId) : undefined,
        ip: req.ip,
      })

      if (!decision.allowed) {
        res.status(451).json({
          error: 'Blocked for legal reasons in this jurisdiction',
          code: ErrorCodes.LEGAL_BLOCKED,
          params: { capability, reason: decision.reason ?? 'unreviewed' },
        })
        return
      }

      if (decision.demo) {
        res.setHeader('X-VGR-Demo', 'true')
      }
      // Downstream handlers read the verdict (e.g. 'restricted') here.
      res.locals.legalGate = decision
      next()
    } catch (err) {
      // Fail closed — same posture as requirePrivilege (decision 72).
      logger.error('Legal gate check failed', { err, capability })
      res.status(500).json({ error: 'Internal error', code: ErrorCodes.INTERNAL })
    }
  }
}
