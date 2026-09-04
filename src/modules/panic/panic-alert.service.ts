import * as repository from '@modules/panic/panic-alert.repository'
import * as responderPoolService from '@modules/panic/responder-pool.service'
import {
  PanicAlertActor,
  PanicAlertRow,
  ResolvePanicAlertResult,
  ResponderAlertsQuery,
  ResponderAlertView,
  TriggerPanicAlertInput,
  TriggerPanicAlertResult,
} from '@modules/panic/panic-alert.interface'
import { appendAccountabilityLogEntry } from '@shared/audit/accountability'
import { ErrorCodes } from '@shared/errors/error-codes'
import { HttpError } from '@shared/errors/http-error'
import { Capabilities } from '@shared/legal/capabilities'
import { assertCapability } from '@shared/legal/legal-gate'
import { DISTANCE_STEP_BY_TIER, haversineKm, snap } from '@shared/geo/degrade'
import logger from '@shared/logger/logger'

/**
 * TriggerPanicAlert / ResolvePanicAlert / responder inbox — the PanicAlert
 * aggregate of PP1 (plano-panico.md, decisions 51, 190-199). Notifies a
 * restricted pool of Authorized Responders (51), never the general
 * helper pool; each responder sees the alert and a degraded distance,
 * never who else got it and never the raw position.
 */

const notFound = () => new HttpError(404, 'Panic alert not found', undefined, ErrorCodes.NOT_FOUND)

/** Ownership as reports.service defines it: account match OR the bearer
 *  clientKey (decision 134 pattern) — the same shape trigger uses to
 *  identify the caller, reused here so resolve recognizes the same
 *  person who triggered (197: only the triggerer may resolve). */
function owns(alert: PanicAlertRow, actor: { accountId: number | null; clientKey: string | null }): boolean {
  if (actor.accountId !== null && alert.accountId === actor.accountId) return true
  return actor.clientKey !== null && alert.clientKey === actor.clientKey
}

function toTriggerResult(
  alert: PanicAlertRow,
  recipientCount: number,
  replayed: boolean
): TriggerPanicAlertResult {
  return {
    alertId: alert.id,
    createdAt: alert.createdAt.toISOString(),
    recipientCount,
    replayed,
  }
}

/**
 * TriggerPanicAlert (decisions 51/65/191/192/195/196/198). Ordering
 * encodes the product's principles, as submitReport/chat-post/rateHelper
 * do:
 *
 *  1. Idempotency first (137): a replay of the same clientKey answers the
 *     SAME alert (recipientCount re-derived from the snapshot) even if
 *     the pool changed since — a flaky network is never punished.
 *  2. Cooldown (198) — ONLY when the caller is identified: an anonymous
 *     trigger carries a FRESH clientKey every time and therefore has no
 *     stable identity to cooldown-check across requests — this is a
 *     deliberate, documented gap, not an oversight (same posture as
 *     anonymous reports never being identity-rate-limited, only IP-rate-
 *     limited by the shared per-IP limiter already wrapping /app-panic).
 *  3. Legal Gate before any write (451) — `panic.dispatch`.
 *  4. Snapshot the CURRENT active responder pool and insert; an EMPTY
 *     pool is NEVER a refusal (65, the plan's success criterion 2) — the
 *     alert is created regardless, with zero recipients if that is what
 *     the pool happens to be.
 *  5. Accountability for the anonymous triggerer (23), never blocking
 *     (123) — pattern of help_offer.submit.
 */
export async function triggerAlert(
  input: TriggerPanicAlertInput,
  actor: PanicAlertActor
): Promise<TriggerPanicAlertResult> {
  const existing = await repository.findAlertByClientKey(input.clientKey)
  if (existing) {
    const recipientCount = await repository.countRecipients(existing.id)
    return toTriggerResult(existing, recipientCount, true)
  }

  if (actor.accountId !== null) {
    const active = await repository.findActiveAlertByAccount(actor.accountId)
    if (active) {
      throw new HttpError(
        409,
        'An unresolved panic alert already exists for this account',
        undefined,
        ErrorCodes.PANIC_ALERT_ACTIVE
      )
    }
  }

  await assertCapability(Capabilities.PANIC_DISPATCH, {
    userRef: actor.accountId === null ? undefined : String(actor.accountId),
    ip: actor.ip,
  })

  // Decision 51: recipients are the Authorized Responder pool ONLY (193
  // keeps the trusted-contact union member out of this round).
  const responders = await responderPoolService.findActiveResponders()

  const alert = await repository.insertAlert({
    clientKey: input.clientKey,
    accountId: actor.accountId,
    lat: input.lat,
    lng: input.lng,
  })
  await repository.insertRecipients(
    alert.id,
    responders.map((responder) => responder.userId)
  )

  if (actor.accountId === null) {
    try {
      // Decision 23: the anonymous triggerer's act leaves the forensic
      // trail — the alert id only, never the position — and, like
      // submitReport, never blocks the flow (123).
      await appendAccountabilityLogEntry('panic_alert.trigger', actor.ip, { alertId: alert.id })
    } catch (err) {
      logger.error('Accountability write failed for panic_alert.trigger', { err, alertId: alert.id })
    }
  }

  return toTriggerResult(alert, responders.length, false)
}

/**
 * The responder inbox (GET /app-panic/alerts, decisions 51/192/195).
 * Only alerts where the caller is a snapshotted recipient — never a live
 * membership check, so a responder approved AFTER an alert fired never
 * sees it retroactively. distanceKm reuses DISTANCE_STEP_BY_TIER.high
 * uniformly (decision 195: a panic alert has no Category/RiskTierConfig
 * to look up a tier from, so the MOST PROTECTIVE step — 1 km rounding —
 * is applied to every alert, never a finer one). The alert's raw lat/lng
 * never serializes; resolved alerts stay in the list, flagged.
 */
export async function listAlertsForResponder(
  responderAccountId: number,
  query: ResponderAlertsQuery
): Promise<{ alerts: ResponderAlertView[] }> {
  const rows = await repository.findAlertsForResponder(responderAccountId, query.after, query.limit)
  const viewerPosition = { lat: query.lat, lng: query.lng }
  return {
    alerts: rows.map((row) => ({
      alertId: row.alertId,
      distanceKm: snap(
        haversineKm(viewerPosition, { lat: row.lat, lng: row.lng }),
        DISTANCE_STEP_BY_TIER.high
      ),
      createdAt: row.createdAt.toISOString(),
      resolved: row.status === 'resolved',
    })),
  }
}

/**
 * ResolvePanicAlert (decision 197): ONLY the triggerer resolves — account
 * match OR the clientKey bearer secret (134 pattern), exactly like
 * reports/chat/rating's owns(). Anyone else — a responder who answered,
 * an admin — gets the SAME 404 a missing alert gets (55: existence is
 * information, never a hint). Atomic active -> resolved; a second
 * attempt is 409 PANIC_ALERT_ALREADY_RESOLVED.
 */
export async function resolveAlert(
  alertId: number,
  actor: { accountId: number | null; clientKey: string | null }
): Promise<ResolvePanicAlertResult> {
  const alert = await repository.findAlertById(alertId)
  if (!alert) throw notFound()
  if (!owns(alert, actor)) throw notFound()

  const transitioned = await repository.resolveAlert(alertId)
  if (!transitioned) {
    throw new HttpError(
      409,
      'This panic alert is already resolved',
      undefined,
      ErrorCodes.PANIC_ALERT_ALREADY_RESOLVED
    )
  }
  return { alertId, status: 'resolved' }
}
