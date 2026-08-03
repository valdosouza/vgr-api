/** Fixed list from decision 10 — the app offers exactly these choices. */
export const HELP_TYPES = [
  'physical_presence',
  'relay_information',
  'remote_support',
  'share',
  'financial_contribution',
] as const

export type HelpType = (typeof HELP_TYPES)[number]

export interface HelpOfferRow {
  id: number
  reportId: number
  helperAccountId: number | null
  anonymous: boolean
  helpType: HelpType
  createdAt: Date
}

export interface SubmitHelpOfferInput {
  reportId: number
  helpType: HelpType
  /** Decision 6/34: identification is the HELPER's choice; a logged-in
   *  helper may still offer anonymously. */
  anonymous: boolean
}

export interface SubmitHelpOfferContext {
  accountId: number | null
  ip: string
}

/** What the report OWNER sees per offer (decisions 6/40/41/60): identity
 *  only when the helper chose it AND the tier is not high; timestamps
 *  never on high tier. */
export interface HelpOfferView {
  helpOfferId: number
  helpType: HelpType
  helperDisplayName: string | null
  createdAt: string | null
}
