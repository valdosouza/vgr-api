/** Fixed list from decision 10 — the app offers exactly these choices.
 *  Promoted to shared (like `Direction`) because help-offers, reports and
 *  the panel views all read it; `help-offers.interface.ts` re-exports. */
export const HELP_TYPES = [
  'physical_presence',
  'relay_information',
  'remote_support',
  'share',
  'financial_contribution',
] as const

export type HelpType = (typeof HELP_TYPES)[number]

/** `tb_help_offer_type` (decision 209) is read back as one GROUP_CONCAT
 *  string per offer, ordered by type — split here, once, for every reader. */
export function splitHelpTypes(concat: string | null | undefined): HelpType[] {
  return concat ? (concat.split(',') as HelpType[]) : []
}
