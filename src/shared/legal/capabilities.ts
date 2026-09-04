/**
 * Legal capability catalog — the blockable unit of the Legal Gate
 * (decision 103: the domain verb, `domain.action[.qualifier]`, stable
 * across refactors and readable by the manager who promotes rules).
 *
 * This TS catalog is the ENFORCEMENT source of truth: a key not listed
 * here is treated as blocked everywhere, sandbox included (decision 103,
 * guard 1 — a typo must never become a silent allow). The DB mirror
 * (tb_legal_capability, migration 022) backs the admin UI and the rule
 * FK; capabilities.catalog.spec.ts asserts the two stay in sync.
 */
export const Capabilities = {
  /** Anonymous reporting with hidden accountability log (decisions 23, 32). */
  REPORT_ANONYMOUS: 'report.anonymous',
  /** Attaching image evidence to a report (decisions 129, 134, 138). */
  REPORT_MEDIA: 'report.media',
  /** Publishing a reward promise — CC arts. 854-860 (decisions 1, 30). */
  REWARD_OFFER: 'reward.offer',
  /** Monetary reward via the payment rail (decisions 82, 97). */
  REWARD_MONETARY: 'reward.monetary',
  /** Deciding condition fulfillment, instructing release/refund (decision 98). */
  REWARD_MEDIATION: 'reward.mediation',
  /** Intermediation by a licensed third-party PSP (decisions 81, 91, 100). */
  REWARD_INTERMEDIATION_DELEGATED: 'reward.intermediation.delegated',
  /** VGR as intermediary — blocked until BACEN authorization (decisions 81, 99). */
  REWARD_INTERMEDIATION_OWN: 'reward.intermediation.own',
  /** Missing-child data retention (decision 25 — LGPD art. 14). */
  MINOR_DATA_RETENTION: 'minor.data_retention',
  /** Helper identity disclosure flows (decisions 6, 34, 40). */
  IDENTITY_DISCLOSURE: 'identity.disclosure',
  /** Location trails and direction sightings (decisions 7, 22, 26). */
  LOCATION_TRACKING: 'location.tracking',
  /** Cross-border personal data transfer (decision 105). */
  DATA_CROSS_BORDER: 'data.cross_border',
  /** Panic-button dispatch to responders (decisions 51-52, 62-63). */
  PANIC_DISPATCH: 'panic.dispatch',
  /** Masked reporter <-> helper chat (decisions 54, 176): text between
   *  anonymous parties carries jurisdiction-dependent legal risk, like
   *  media (138). Born WIRED in C1 (messaging/chat.service.ts). */
  CHAT_MASKED: 'chat.masked',
  /** The reporter rates a helper once the case is resolved; the score
   *  accumulates on the helper's INTERNAL identity (decisions 48, 188):
   *  reputation is profiling of a person, and its legal risk varies by
   *  jurisdiction as much as the chat's (176). Born WIRED in RT1
   *  (ratings/helper-rating.service.ts, asserted before the insert). */
  HELPER_RATING: 'helper.rating',
} as const

export type Capability = (typeof Capabilities)[keyof typeof Capabilities]

const KNOWN = new Set<string>(Object.values(Capabilities))

/** Guard 1 of decision 103: unknown key -> blocked, never allowed. */
export function isKnownCapability(key: string): key is Capability {
  return KNOWN.has(key)
}

/**
 * Guard 2 of decision 103: a cataloged capability with no caller is debt,
 * not protection. The domain features that consume the gate (report,
 * reward, panic dispatch) are still unbuilt — every entry below is awaiting
 * its consumer. capabilities.catalog.spec.ts asserts that PENDING_WIRING
 * plus the actually-called capabilities exactly partition the catalog, so
 * an entry can never silently be neither wired nor declared pending.
 * When a domain task wires a capability, it MUST remove the entry here —
 * the spec fails otherwise.
 */
export const PENDING_WIRING: ReadonlySet<Capability> = new Set<Capability>([
  // report.anonymous: WIRED in R1 (reports.service.ts, decisions 134-142)
  // and therefore removed — the partition spec enforces the removal.
  // report.media: born WIRED in R4 (reports.service attach, decision 138),
  // so it never entered this set.
  // reward.offer, reward.monetary: WIRED in Reward R0 (reward.service.ts
  // offerReward, decisions 1/30/143-147) and therefore removed.
  // reward.intermediation.delegated: WIRED in the same delivery
  // (reserveGuarantee).
  // reward.mediation: WIRED in the same delivery (today asserted by the
  // propose/approve/execute cycle of decisions 148/149).
  // chat.masked: born WIRED in C1 (messaging/chat.service.ts, decision
  // 176 — asserted before thread creation and before every post), so it
  // never entered this set.
  // helper.rating: decision 188 has it born pending and wired in RT1 —
  // both happened in the same delivery (ratings/helper-rating.service.ts
  // asserts it before the insert), so it never entered this set either.
  Capabilities.REWARD_INTERMEDIATION_OWN,
  Capabilities.MINOR_DATA_RETENTION,
  Capabilities.IDENTITY_DISCLOSURE,
  Capabilities.LOCATION_TRACKING,
  Capabilities.DATA_CROSS_BORDER,
  Capabilities.PANIC_DISPATCH,
])

/**
 * Capability dependencies (decision 98): a capability may require another
 * one allowed in the same jurisdiction. reward.monetary without
 * reward.mediation would accept reserves the platform cannot release —
 * third-party money stuck with no exit, the exact state decision 84 exists
 * to prevent. Enforced on rule promotion (legal-policy service) AND on
 * gate evaluation (legal-gate), so neither path can create the incoherent
 * state.
 */
export const CAPABILITY_REQUIRES: Readonly<Partial<Record<Capability, Capability>>> = {
  [Capabilities.REWARD_MONETARY]: Capabilities.REWARD_MEDIATION,
}
