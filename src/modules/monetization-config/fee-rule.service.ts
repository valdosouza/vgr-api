import * as repository from '@modules/monetization-config/fee-rule.repository'
import { FeeRuleRow, PaymentMode } from '@modules/monetization-config/fee-rule.interface'
import { getRiskTier } from '@shared/risk/risk-tier'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'

const TTL_MS = 60_000

/**
 * Amendment (task 22's precedent, applied here): the tactical design
 * doesn't specify a default for a Category with neither its own rule nor
 * a global one — no fee, both payment modes allowed, is the least
 * restrictive option absent explicit admin configuration (mirrors
 * risk-config's 'low'-tier default philosophy). The independent
 * RiskTier-high veto on peer_to_peer (decision 58, enforced in the
 * `payments` module once it exists) still applies regardless of this
 * default.
 */
const DEFAULT_FEE_PERCENT = 0
const DEFAULT_PAYMENT_MODES: PaymentMode[] = ['intermediated', 'peer_to_peer']

const cache = new Map<string, { rule: FeeRuleRow; expiresAt: number }>()

/**
 * Decisions 58/82 — the veto that closes the leak the feature doc
 * flagged: a direct payer→helper transfer puts the helper's name on the
 * payer's bank record, in exactly the categories where retaliation risk
 * is highest. The EFFECTIVE rule for a high-tier category never contains
 * peer_to_peer, wherever it came from (own rule, global fallback,
 * built-in default, or a tier raised after the rule was written). Applied
 * OUTSIDE the fee cache so a tier change converges on the tier cache's
 * own TTL, not this one's.
 */
async function applyTierVeto(rule: FeeRuleRow, category: string): Promise<FeeRuleRow> {
  if ((await getRiskTier(category)) !== 'high') return rule
  return {
    ...rule,
    paymentModeAllowed: rule.paymentModeAllowed.filter((mode) => mode !== 'peer_to_peer'),
  }
}

export async function getFeeRule(category: string): Promise<FeeRuleRow> {
  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return applyTierVeto(cached.rule, category)
  }

  const specific = await repository.findFeeRuleByCategory(category)
  const fallback = specific ?? (await repository.findFeeRuleByCategory(null))
  const rule: FeeRuleRow = fallback
    ? { ...fallback, category }
    : { category, feePercent: DEFAULT_FEE_PERCENT, paymentModeAllowed: DEFAULT_PAYMENT_MODES }

  cache.set(category, { rule, expiresAt: Date.now() + TTL_MS })
  return applyTierVeto(rule, category)
}

export async function setFeeRule(
  category: string | null,
  feePercent: number,
  paymentModeAllowed: PaymentMode[]
): Promise<void> {
  // Write-time refusal (58): configuring the leak explicitly is an error
  // the admin sees, not a silently-stripped save. The global rule stays
  // free to allow peer_to_peer — low/medium categories legitimately use
  // it; high ones are covered by the read-time veto above.
  if (
    category !== null &&
    paymentModeAllowed.includes('peer_to_peer') &&
    (await getRiskTier(category)) === 'high'
  ) {
    throw new HttpError(
      422,
      'High-risk categories cannot allow peer_to_peer payment',
      undefined,
      ErrorCodes.BUSINESS_RULE
    )
  }
  await repository.upsertFeeRule(category, feePercent, paymentModeAllowed)
  // Updating the global rule can change the effective rule for every
  // Category that falls back to it — clear everything rather than track
  // which cached entries were fallback-derived.
  if (category === null) {
    cache.clear()
  } else {
    cache.delete(category)
  }
}

/** Not TTL-cached — the admin list view always reads the current DB state. */
export async function listFeeRules(): Promise<FeeRuleRow[]> {
  return repository.findAllFeeRules()
}
