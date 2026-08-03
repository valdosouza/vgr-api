export type RiskTier = 'low' | 'medium' | 'high'

export interface RiskTierConfigRow {
  category: string
  tier: RiskTier
}
