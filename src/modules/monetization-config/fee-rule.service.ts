import * as repository from '@modules/monetization-config/fee-rule.repository'
import { FeeRuleRow, PaymentMode } from '@modules/monetization-config/fee-rule.interface'

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

export async function getFeeRule(category: string): Promise<FeeRuleRow> {
  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.rule
  }

  const specific = await repository.findFeeRuleByCategory(category)
  const fallback = specific ?? (await repository.findFeeRuleByCategory(null))
  const rule: FeeRuleRow = fallback
    ? { ...fallback, category }
    : { category, feePercent: DEFAULT_FEE_PERCENT, paymentModeAllowed: DEFAULT_PAYMENT_MODES }

  cache.set(category, { rule, expiresAt: Date.now() + TTL_MS })
  return rule
}

export async function setFeeRule(
  category: string | null,
  feePercent: number,
  paymentModeAllowed: PaymentMode[]
): Promise<void> {
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
