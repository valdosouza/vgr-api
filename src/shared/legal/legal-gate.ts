import { CAPABILITY_REQUIRES, Capability, isKnownCapability } from '@shared/legal/capabilities'
import * as repository from '@shared/legal/legal-gate.repository'
import {
  ActiveRuleRow,
  GateContext,
  GateDecision,
  GateReason,
} from '@shared/legal/legal-gate.interface'
import { HttpError } from '@shared/errors/http-error'
import { ErrorCodes } from '@shared/errors/error-codes'
import logger from '@shared/logger/logger'

/**
 * The Legal Gate decision point (decisions 76-79, 103-109).
 *
 * - Fail-closed (104): no active, unexpired rule in a real jurisdiction
 *   means blocked; only SANDBOX inverts the default (79), and an explicit
 *   rule wins even there.
 * - Unknown capability blocks everywhere, sandbox included (103).
 * - Rules are cached with a 60s TTL; on lookup failure the last known
 *   state is served for a bounded window, then everything blocks (109).
 * - operational_state (kill switch) is read with TTL ZERO and never
 *   participates in degradation: if it cannot be read, the jurisdiction is
 *   treated as suspended (107, 109).
 * - Expired rule = unreviewed = blocked (108), judged at read time — no
 *   scheduler needed for enforcement.
 */

const RULE_TTL_MS = 60_000

/** Decision 109 — default 15 min; configurable, never disableable. */
function degradedWindowMs(): number {
  const parsed = Number(process.env.LEGAL_GATE_DEGRADED_WINDOW_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60_000
}

/**
 * The installation's jurisdiction (decisions 68, 105 — one per country).
 * Unset in production resolves to a code that matches no jurisdiction row,
 * so everything fails closed rather than silently running as sandbox.
 */
export function installationJurisdiction(): string {
  const configured = process.env.LEGAL_JURISDICTION?.trim().toUpperCase()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    logger.error('LEGAL_JURISDICTION is not set in production — failing closed')
    return 'UNCONFIGURED'
  }
  return 'SANDBOX'
}

interface CachedRule {
  rule: ActiveRuleRow | null
  fetchedAt: number
}

const ruleCache = new Map<string, CachedRule>()

/** Call after any rule promotion/rejection (legal-policy service). */
export function invalidateLegalGateCache(): void {
  ruleCache.clear()
}

function audit(entry: {
  capability: string
  jurisdictionCode: string
  rule?: { id: number; version: number }
  outcome: 'blocked' | 'demo' | 'degraded'
  reason: string | null
  ctx?: GateContext
}): void {
  // Fire-and-forget: an audit-write failure must not take the product down
  // with it, but it is never silent (plan L6).
  repository
    .insertAudit({
      capability: entry.capability,
      jurisdictionCode: entry.jurisdictionCode,
      ruleId: entry.rule?.id ?? null,
      ruleVersion: entry.rule?.version ?? null,
      outcome: entry.outcome,
      reason: entry.reason,
      userRef: entry.ctx?.userRef ?? null,
      ip: entry.ctx?.ip ?? null,
    })
    .catch((err) => logger.error('Legal gate audit write failed', { err, entry }))
}

function isExpired(rule: ActiveRuleRow, now: number): boolean {
  return rule.expiresAt !== null && rule.expiresAt.getTime() <= now
}

/** Rule lookup with TTL cache + bounded degraded window (decision 109). */
async function getRule(
  capability: string,
  jurisdictionCode: string
): Promise<{ rule: ActiveRuleRow | null; degraded: boolean } | 'unavailable'> {
  const key = `${jurisdictionCode}:${capability}`
  const cached = ruleCache.get(key)
  const now = Date.now()

  if (cached && now - cached.fetchedAt < RULE_TTL_MS) {
    return { rule: cached.rule, degraded: false }
  }

  try {
    const rule = await repository.findActiveRule(capability, jurisdictionCode)
    ruleCache.set(key, { rule, fetchedAt: now })
    return { rule, degraded: false }
  } catch (err) {
    logger.error('Legal gate rule lookup failed', { err, capability, jurisdictionCode })
    // Degradation serves ONLY keys already in cache (decision 109) — a
    // capability this instance never resolved has no "last known state".
    if (cached && now - cached.fetchedAt < degradedWindowMs()) {
      return { rule: cached.rule, degraded: true }
    }
    return 'unavailable'
  }
}

async function evaluate(
  capability: string,
  ctx: GateContext | undefined,
  auditOutcome: boolean
): Promise<GateDecision> {
  const jurisdictionCode = installationJurisdiction()
  const blocked = (reason: GateReason, extra?: Partial<GateDecision>): GateDecision => {
    if (auditOutcome) {
      audit({ capability, jurisdictionCode, outcome: 'blocked', reason, rule: extra?.rule, ctx })
    }
    return { allowed: false, demo: false, degraded: false, restricted: false, reason, ...extra }
  }

  // Guard 1 of decision 103 — before anything else, sandbox included.
  if (!isKnownCapability(capability)) {
    return blocked('unknown_capability')
  }

  // Kill switch: TTL zero, outside the degraded path (decisions 107, 109).
  let jurisdiction
  try {
    jurisdiction = await repository.findJurisdiction(jurisdictionCode)
  } catch (err) {
    logger.error('Legal gate jurisdiction lookup failed — treating as suspended', {
      err,
      jurisdictionCode,
    })
    return blocked('suspended')
  }
  if (!jurisdiction) {
    return blocked('unknown_state')
  }
  if (jurisdiction.operationalState === 'suspended') {
    return blocked('suspended')
  }

  const lookup = await getRule(capability, jurisdictionCode)
  if (lookup === 'unavailable') {
    return blocked('unavailable')
  }
  const { degraded } = lookup
  const now = Date.now()
  const rule = lookup.rule && !isExpired(lookup.rule, now) ? lookup.rule : null
  const ruleRef = rule ? { id: rule.id, version: rule.version } : undefined

  let decision: GateDecision

  if (rule) {
    // An explicit rule wins everywhere, sandbox included.
    if (rule.status === 'blocked') {
      decision = blocked(rule.reason ?? 'unreviewed', { rule: ruleRef })
    } else if (jurisdiction.operationalState === 'restricted' && rule.status !== 'allowed') {
      // Jurisdiction 'restricted' lets only explicit 'allowed' through (plan §7).
      decision = blocked('restricted', { rule: ruleRef })
    } else {
      decision = {
        allowed: true,
        demo: false,
        degraded,
        restricted: rule.status === 'restricted',
        rule: ruleRef,
      }
    }
  } else if (jurisdiction.isSandbox) {
    // Sandbox inverts the no-rule default (decision 79) — and marks demo.
    decision = { allowed: true, demo: true, degraded, restricted: false }
    if (auditOutcome) {
      audit({ capability, jurisdictionCode, outcome: 'demo', reason: null, ctx })
    }
  } else {
    decision = blocked('unreviewed')
  }

  // Dependency check (decision 98): the required capability must also be
  // allowed here. Single-level by construction; evaluated without audit to
  // avoid double entries for one request.
  if (decision.allowed) {
    const required = CAPABILITY_REQUIRES[capability as Capability]
    if (required) {
      const dep = await evaluate(required, ctx, false)
      if (!dep.allowed) {
        decision = blocked('dependency', { rule: ruleRef })
      }
    }
  }

  if (decision.allowed && degraded && auditOutcome) {
    audit({ capability, jurisdictionCode, outcome: 'degraded', reason: null, rule: ruleRef, ctx })
  }

  return decision
}

/** The gate's question: may this capability execute here, right now? */
export async function checkCapability(
  capability: string,
  ctx?: GateContext
): Promise<GateDecision> {
  return evaluate(capability, ctx, true)
}

/**
 * Service-layer enforcement for paths that never cross the HTTP gateway —
 * offline queue (decision 28), scheduled jobs (decision 90). Throws
 * HTTP 451 (Unavailable For Legal Reasons) with the stable code the client
 * translates (decision 80).
 */
export async function assertCapability(capability: string, ctx?: GateContext): Promise<GateDecision> {
  const decision = await checkCapability(capability, ctx)
  if (!decision.allowed) {
    throw new HttpError(
      451,
      'Blocked for legal reasons in this jurisdiction',
      undefined,
      ErrorCodes.LEGAL_BLOCKED,
      { capability, reason: decision.reason ?? 'unreviewed' }
    )
  }
  return decision
}
