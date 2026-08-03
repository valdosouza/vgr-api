import pool from '@shared/db/connection'
import { RiskTier, RiskTierConfigRow } from './risk-config.interface'

export async function findRiskTierConfigByCategory(category: string): Promise<RiskTierConfigRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT category, tier FROM tb_risk_tier_config WHERE category = ?`,
    [category]
  )
  return rows[0] ?? null
}

export async function findAllRiskTierConfigs(): Promise<RiskTierConfigRow[]> {
  const [rows] = await pool.query<any[]>(`SELECT category, tier FROM tb_risk_tier_config ORDER BY category`)
  return rows
}

export async function upsertRiskTierConfig(category: string, tier: RiskTier): Promise<void> {
  await pool.query(
    `INSERT INTO tb_risk_tier_config (category, tier) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE tier = VALUES(tier)`,
    [category, tier]
  )
}
