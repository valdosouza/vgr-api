import pool from '@shared/db/connection'

/**
 * Read side of RiskTierConfig (decision 46), promoted from
 * modules/risk-config when the feed became a consumer (decision 135 —
 * degraded position by tier). This is the extraction the tactical
 * design's task-32 note and docs/feature/monetization-config.md flagged
 * as pending a forcing consumer. The risk-config module keeps the admin
 * CRUD and invalidates this ONE cache on write.
 *
 * Default for an unconfigured category is 'low' (task-22 amendment) —
 * which is why migration 031 SEEDS every category: 'low' means
 * street-level precision on the public feed (135), and that default must
 * be a conscious admin choice, never an accident of a missing row.
 */
export type RiskTier = 'low' | 'medium' | 'high'

const TTL_MS = 60_000
const DEFAULT_TIER: RiskTier = 'low'
const cache = new Map<string, { tier: RiskTier; expiresAt: number }>()

export async function getRiskTier(category: string | null): Promise<RiskTier> {
  // Free-tag reports have no category to configure — served at the safe
  // middle: not street-precise, not hidden.
  if (category === null) return 'medium'

  const cached = cache.get(category)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tier
  }
  const [rows] = await pool.query<any[]>(
    `SELECT tier FROM tb_risk_tier_config WHERE category = ?`,
    [category]
  )
  const tier: RiskTier = rows[0]?.tier ?? DEFAULT_TIER
  cache.set(category, { tier, expiresAt: Date.now() + TTL_MS })
  return tier
}

/** Called by the admin write path (risk-config module) after an upsert. */
export function invalidateRiskTierCache(category?: string): void {
  if (category === undefined) cache.clear()
  else cache.delete(category)
}
