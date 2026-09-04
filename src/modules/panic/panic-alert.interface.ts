/**
 * PanicAlert — the aggregate of PP1 (plano-panico.md, decisions 51,
 * 190-199). A SINGLE SHOT (191): one position captured at trigger time,
 * no live/streaming session, no position updates after that. Ownership
 * mirrors tb_report (030_reports.sql): client_key is BOTH the app's
 * idempotency key (pattern of 137) AND the anonymous triggerer's bearer
 * secret (134) — a cold, anonymous witness can trigger exactly like an
 * anonymous reporter files a report (32/35, decision 65's "no
 * configuration required at the click").
 */

export type PanicAlertStatus = 'active' | 'resolved'

export interface PanicAlertRow {
  id: number
  clientKey: string
  /** NULL for an anonymous trigger — identity is social/interface-level,
   *  never forensic (23); a fresh anonymous trigger is a fresh identity
   *  by design (no stable id to cooldown-check across requests). */
  accountId: number | null
  /** Raw position at trigger time. NEVER served raw to anyone (135's
   *  posture applied here) — only the rounded distance a responder
   *  computes against their OWN position (195) ever leaves the API. */
  lat: number
  lng: number
  status: PanicAlertStatus
  createdAt: Date
  resolvedAt: Date | null
}

export interface TriggerPanicAlertInput {
  clientKey: string
  lat: number
  lng: number
}

/** Who is triggering/resolving — the reports' ViewerContext shape
 *  (account and/or the alert's clientKey from the x-client-key header)
 *  plus the IP for the gate and the accountability trail (23). */
export interface PanicAlertActor {
  accountId: number | null
  clientKey: string | null
  ip: string
}

export interface TriggerPanicAlertResult {
  alertId: number
  createdAt: string
  /** Never WHO — only how many (platform-wide rule: responder/helper
   *  identities never reach the person who triggered/reported). */
  recipientCount: number
  /** True when the clientKey had already been accepted (137) — the
   *  controller answers 200 instead of 201. */
  replayed: boolean
}

/** One row of the trigger-time snapshot (tb_panic_alert_recipient) —
 *  never mutated after insert; a membership revoked later does not
 *  retroactively remove the historical fact that this responder WAS a
 *  recipient at trigger time. */
export interface PanicAlertRecipientRow {
  id: number
  alertId: number
  responderAccountId: number
}

/** The raw fact behind a responder's inbox row — the service degrades
 *  lat/lng into distanceKm before it ever serializes (195). */
export interface ResponderAlertRow {
  alertId: number
  lat: number
  lng: number
  status: PanicAlertStatus
  createdAt: Date
}

export interface ResponderAlertsQuery {
  /** Cursor: only alerts with id > after (192, mirrors chat's after=<id>). */
  after: number
  limit: number
  /** The responder's OWN current position — required: the server cannot
   *  compute "distance to me" without knowing where "me" is right now. */
  lat: number
  lng: number
}

export interface ResponderAlertView {
  alertId: number
  distanceKm: number
  createdAt: string
  resolved: boolean
}

export interface ResolvePanicAlertResult {
  alertId: number
  status: 'resolved'
}
