export type PaymentMode = 'intermediated' | 'peer_to_peer'

/** `category: null` is the global default (decision 39) — falls back for
 *  any Category without its own rule. */
export interface FeeRuleRow {
  category: string | null
  feePercent: number
  paymentModeAllowed: PaymentMode[]
}
