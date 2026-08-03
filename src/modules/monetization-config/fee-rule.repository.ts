import pool from '@shared/db/connection'
import { FeeRuleRow, PaymentMode } from '@modules/monetization-config/fee-rule.interface'

/** DB sentinel for the global/`null`-category row — `category` is a
 *  VARCHAR PRIMARY KEY like risk-config's, so it can't literally be NULL;
 *  no real curated Category is named "global" (see the taxonomy in
 *  VGR-plano.md), so there's no collision risk. */
const GLOBAL_CATEGORY = 'global'

function toRow(row: any): FeeRuleRow {
  return {
    category: row.category === GLOBAL_CATEGORY ? null : row.category,
    feePercent: row.feePercent,
    paymentModeAllowed: JSON.parse(row.paymentModeAllowed),
  }
}

export async function findFeeRuleByCategory(category: string | null): Promise<FeeRuleRow | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT category, fee_percent AS feePercent, payment_mode_allowed AS paymentModeAllowed
     FROM tb_fee_rule WHERE category = ?`,
    [category ?? GLOBAL_CATEGORY]
  )
  return rows[0] ? toRow(rows[0]) : null
}

export async function findAllFeeRules(): Promise<FeeRuleRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT category, fee_percent AS feePercent, payment_mode_allowed AS paymentModeAllowed
     FROM tb_fee_rule ORDER BY category`
  )
  return rows.map(toRow)
}

export async function upsertFeeRule(
  category: string | null,
  feePercent: number,
  paymentModeAllowed: PaymentMode[]
): Promise<void> {
  await pool.query(
    `INSERT INTO tb_fee_rule (category, fee_percent, payment_mode_allowed) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE fee_percent = VALUES(fee_percent), payment_mode_allowed = VALUES(payment_mode_allowed)`,
    [category ?? GLOBAL_CATEGORY, feePercent, JSON.stringify(paymentModeAllowed)]
  )
}
