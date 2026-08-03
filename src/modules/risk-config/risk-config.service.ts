import * as repository from './risk-config.repository'
import { RiskTier } from './risk-config.interface'
import { getRiskTier as readTier, invalidateRiskTierCache } from '@shared/risk/risk-tier'

/**
 * Admin CRUD stays here; the READ path (TTL cache, decision 46) moved to
 * @shared/risk/risk-tier when the feed became a consumer (decision 135) —
 * the extraction task-32's note flagged as pending a forcing consumer.
 * One cache, invalidated on write. The 'low' default for an unconfigured
 * category (task-22 amendment) lives there too — and migration 031 seeds
 * every category so that default is a conscious choice, not an accident.
 */
export async function getRiskTier(category: string): Promise<RiskTier> {
  return readTier(category)
}

export async function setRiskTier(category: string, tier: RiskTier): Promise<void> {
  await repository.upsertRiskTierConfig(category, tier)
  invalidateRiskTierCache(category)
}

/** Not TTL-cached — the admin list view always reads the current DB state. */
export async function listRiskTierConfigs() {
  return repository.findAllRiskTierConfigs()
}
