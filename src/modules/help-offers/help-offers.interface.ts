import type { HelpType } from '@shared/help-offer/help-types'

/** Fixed list from decision 10 lives in shared (read by reports too). */
export { HELP_TYPES } from '@shared/help-offer/help-types'
export type { HelpType } from '@shared/help-offer/help-types'

export interface HelpOfferRow {
  id: number
  reportId: number
  helperAccountId: number | null
  anonymous: boolean
  /** One offer, several fronts (decision 208) — at least one, no repeats. */
  helpTypes: HelpType[]
  createdAt: Date
}

export interface SubmitHelpOfferInput {
  reportId: number
  helpTypes: HelpType[]
  /** Decision 6/34: identification is the HELPER's choice; a logged-in
   *  helper may still offer anonymously. */
  anonymous: boolean
}

export interface SubmitHelpOfferContext {
  accountId: number | null
  ip: string
}

/** Decision 211: the helper replaces the whole set while the report is
 *  open; only an offer with an account behind it can prove ownership. */
export interface UpdateHelpOfferTypesInput {
  helpOfferId: number
  helpTypes: HelpType[]
}

export interface UpdateHelpOfferTypesContext {
  accountId: number
}

/** What the report OWNER sees per offer (decisions 6/40/41/60): identity
 *  only when the helper chose it AND the tier is not high; timestamps
 *  never on high tier. */
export interface HelpOfferView {
  helpOfferId: number
  helpTypes: HelpType[]
  helperDisplayName: string | null
  createdAt: string | null
}
