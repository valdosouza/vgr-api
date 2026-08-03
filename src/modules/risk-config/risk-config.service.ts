import * as repository from './risk-config.repository'
import { RiskTier } from './risk-config.interface'

/**
 * TTL cache mirroring the tb_feature_flag pattern (decision 46): admin
 * updates take effect without a code deploy, but reads don't hit the
 * database on every request.
 *
 * Amendment (task 22): the tactical design didn't specify a default for
 * a Category with no configured RiskTier — 'low' is the safest default
 * (no mandatory-anonymity/hidden-engagement restriction unless an admin
 * explicitly opts a Category into a higher tier).
 */
const TTL_MS = 60_000
const DEFAULT_TIER: RiskTier = 'low'

const cache = new Map<string, { tier: RiskTier; expiresAt: number }>()

export async function getRiskTier(category: string): Promise<RiskTier> {
  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tier
  }

  const row = await repository.findRiskTierConfigByCategory(category)
  const tier = row?.tier ?? DEFAULT_TIER
  cache.set(category, { tier, expiresAt: Date.now() + TTL_MS })
  return tier
}

export async function setRiskTier(category: string, tier: RiskTier): Promise<void> {
  await repository.upsertRiskTierConfig(category, tier)
  cache.delete(category)
}

/** Not TTL-cached — the admin list view always reads the current DB state. */
export async function listRiskTierConfigs() {
  return repository.findAllRiskTierConfigs()
}
