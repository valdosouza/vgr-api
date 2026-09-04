# Panic button — PP1 (API)

Decisions 51, 190-199 (`AI/docs/decisions/VGR-plano.md`, round 14); plan
in `AI/docs/plans/plano-panico.md`; spec `PanicAlert`, `AlertRecipient`,
`TriggerPanicAlert`, `PanicAlertRepository`, `ResponderPoolMembership` in
`docs/specs/vgr/003-api-tactical-design.md` (amended 2026-09-04). Module
`src/modules/panic/` — the pre-existing Authorized Responder pool
(`responder-pool.*`) plus the new `PanicAlert` aggregate
(`panic-alert.*`). PP2 (mobile: panic button, alerts screen, responder
request flow — now reachable) and PP3/PP4 (mobile advanced mode, panel)
are NOT here — see "Deliberately out" below.

Invariants (each has a test):

- **A restricted pool, not the general helper pool (51)**: an alert
  notifies only Authorized Responders — accounts with an `approved`
  `tb_responder_pool_membership` row — never the general reporter/helper
  population. Each responder sees the alert AND a degraded distance to
  it, never who else received it.
- **Single shot (191)**: one position is captured at trigger time; there
  is no live/streaming session and no update to a triggered alert's
  position. `tb_panic_alert.lat`/`lng` are written once, at INSERT, and
  never touched again.
- **Never refused for an empty pool (65, plan success criterion 2)**: an
  alert is created regardless of how many active responders exist at
  trigger time — even zero. The recipient list may legitimately end up
  empty; the trigger itself never fails for that reason.
- **Fixed message, no free text (196)**: the trigger request body carries
  no text/message field — the app renders a fixed template client-side
  from `{ alertId, distanceKm }`; the API never stores or forwards
  free-form text for a panic alert.
- **Only the triggerer resolves (197)**: `owns()` — account match OR the
  `x-client-key` bearer secret, the `reports.service` pattern (134) —
  gates `POST .../resolve`. A responder who answered, or an admin, gets
  the SAME 404 a missing alert gets (55: existence is information, never
  a hint).
- **Cooldown, identified callers only (198)**: a caller with an
  unresolved (`status='active'`) alert cannot trigger a new one — 409
  `PANIC_ALERT_ACTIVE`. This is checked ONLY when `appAccountId` is
  present. An anonymous trigger carries a FRESH `clientKey` every time —
  there is no stable identity to look up across requests, so an
  anonymous caller is never cooldown-checked; this is a **documented
  design gap**, not an oversight (the same posture as anonymous reports,
  which are never identity-rate-limited, only IP-rate-limited by the
  shared per-IP limiter already wrapping every `/app-*` mount).
- **Identity/position minimization**: the raw trigger position never
  leaves the API — a responder is served only `distanceKm`, rounded via
  `DISTANCE_STEP_BY_TIER.high` (195). The trigger response never echoes
  `lat`/`lng` back, and never lists who the recipients are (platform-wide
  rule: responder/helper identities never reach the person who
  triggered/reported).
- **Legal Gate (51/190-199, wired like chat/rating)**: `panic.dispatch`
  is asserted before the alert INSERT — blocked → 451 `LEGAL_BLOCKED`,
  nothing written. The capability was declared and seeded by migration
  022 at the catalog's founding and sat in `PENDING_WIRING` until this
  delivery removes it (the catalog partition spec proves it).

## Plane fix — responder-pool `POST` (not a new decision, a correction)

`src/modules/panic/responder-pool.*` (the pool prerequisite) already
existed before this round: `GET /api/panic/responder-pool` (list
pending, admin-gated) and `PUT /api/panic/responder-pool/:id/resolve`
(approve/deny, admin-gated) were correct. `POST /api/panic/responder-pool`
(the mobile user's OWN request to join) was **mounted on the wrong
plane** — the admin-only `/api` router (`authMiddleware`, `audience:
admin`) — so a real mobile user held no admin JWT and could never reach
it; the handler also read `req.user!.userId`, an admin's `tb_user.id`,
where `tb_responder_pool_membership.user_id` is meant to hold an APP
account id (`tb_user_account.id`).

Fixed in PP1: `POST` moved to `POST /app-panic/responder-pool`, guarded
by `appAuthMiddleware` (**required**, never optional — an anonymous
witness cannot become a vetted, accountable responder; unlike reporting
or media upload, decision 190/51 make this an identified-account-only
action). The controller now reads `req.appAccountId!`. `GET` and `PUT
:id/resolve` are unchanged, still under `/api`, still correctly
admin-gated; `resolved_by` there is still the ADMIN's `req.user.userId`.

Decision 190 (closes the pendência opened by 52): eligibility for
becoming an Authorized Responder is **NOT codified** — free human
judgment by an admin, exactly as the pre-existing `criteria_notes` free
text already modeled. Nothing new was built for this; the admin approval
screen is unchanged.

## Plane and routes

App plane, never `/api`.

| Route | Who | Answers |
|---|---|---|
| `POST /app-panic/responder-pool` body `{ criteriaNotes?: string }` | any app account — `appAuthMiddleware`, required | `201 { id, userId, status: 'pending', criteriaNotes, requestedAt, resolvedAt: null, resolvedBy: null }`; `401` anonymous or a forged/panel token |
| `POST /app-panic/alert` body `{ clientKey: uuid, position: { lat, lng } }` | anyone — `optionalAppAuth` (a cold, anonymous witness triggers exactly like an anonymous reporter files a report, 32/35) | `201 { alertId, createdAt, recipientCount }` first accept; `200` (same shape) replay of the same `clientKey`; `409 PANIC_ALERT_ACTIVE` (identified caller only, 198); `422 VALIDATION_FAILED`; `451 LEGAL_BLOCKED`; `401` on a PRESENT but invalid token |
| `GET /app-panic/alerts?after&limit&lat&lng` | an authenticated app account — `appAuthMiddleware`, required (only an identified, currently-approved responder was ever a possible recipient) | `200 { alerts: [{ alertId, distanceKm, createdAt, resolved }] }`, ascending by `alertId`, `id > after`; `422 VALIDATION_FAILED` when `lat`/`lng` are missing; `401` anonymous |
| `POST /app-panic/alerts/:id/resolve` | the triggerer only — account match or `x-client-key` header — `optionalAppAuth` | `200 { alertId, status: 'resolved' }`; `404 NOT_FOUND` (missing or not owner — never 403); `409 PANIC_ALERT_ALREADY_RESOLVED`; `400 INVALID_ID` |

**Mount strategy (`app.ts`)**: `responderPoolAppRoutes` at
`/app-panic/responder-pool`, registered BEFORE the more general
`/app-panic` mount for `panicAlertRoutes` (specific before general, the
`/app-reports/:id/offers` precedent). Neither router imports the other's
controller from outside `modules/panic`; `panic-alert.service.ts` imports
`responder-pool.service.ts` directly — legal, because both files live in
the SAME module folder (`src/modules/panic/`), the same posture as
`reports-admin.service.ts` importing from `reports.repository.ts`.

## Service order (`panic-alert.service.ts triggerAlert`)

Ordering encodes the product's principles, as `submitReport`/chat
`post()`/`rateHelper` do:

1. **Idempotency first (137)** — `findAlertByClientKey`: a replay of the
   same `clientKey` answers the SAME alert (`recipientCount` re-derived
   via `countRecipients`, since the pool may have grown/shrunk since),
   even if the case was resolved since — a flaky network is never
   punished. No gate call, no pool read, no insert on a replay.
2. **Cooldown (198)** — ONLY when `actor.accountId !== null`:
   `findActiveAlertByAccount` → an existing `active` row → 409
   `PANIC_ALERT_ACTIVE`. Skipped entirely for an anonymous caller (see
   the invariant above).
3. **Legal Gate (51/190-199)** — `assertCapability('panic.dispatch', {
   userRef: account | undefined, ip })` → 451 before any write.
4. **Snapshot + insert** — `responderPoolService.findActiveResponders()`
   is read AFTER the gate passes; `insertAlert` then `insertRecipients`
   (empty array is a no-op, not an error) — an empty pool never refuses
   the trigger (65).
5. **Accountability (23)** — the ANONYMOUS triggerer leaves
   `panic_alert.trigger` with `{ alertId }` (never the position), logged
   on failure, never blocking (123) — the pattern of `help_offer.submit`.
   An identified triggerer leaves no entry: the session is the trail.

`resolveAlert`: `findAlertById` → 404 if missing → `owns()` (account or
`clientKey`) → 404 if not the triggerer → atomic
`status='active' -> 'resolved'` → 409 `PANIC_ALERT_ALREADY_RESOLVED` if
the UPDATE affected zero rows (already resolved).

`listAlertsForResponder`: `findAlertsForResponder(responderAccountId,
after, limit)` — a JOIN of `tb_panic_alert_recipient` to `tb_panic_alert`
filtered by `responder_account_id` and `id > after`, ascending. Each row
is mapped to `{ alertId, distanceKm, createdAt, resolved }` via
`snap(haversineKm(responderPosition, alertPosition),
DISTANCE_STEP_BY_TIER.high)` (decision 195 — panic alerts have no
Category/RiskTierConfig to look up a tier from, so the MOST PROTECTIVE
step, 1 km rounding, applies uniformly to every alert rather than
guessing a tier). The alert's raw `lat`/`lng` are read from the
repository but never serialized past the distance computation.

## Storage (migration `046_panic_alert.sql`)

`tb_panic_alert`: `id`, `client_key CHAR(36) UNIQUE` (idempotency key AND
anonymous bearer secret in one, pattern of 137/134 — mirrors
`tb_report.client_key`), `account_id INT NULL` (FK `tb_user_account`,
NULL for an anonymous trigger — mirrors `tb_report.reporter_account_id`),
`lat`/`lng DECIMAL(9,6)` (raw, trigger-time only), `status VARCHAR(10)`
CHECK `active`/`resolved`, `created_at`, `resolved_at`.

`tb_panic_alert_recipient`: the trigger-time snapshot of the active
responder pool — `id`, `tb_panic_alert_id` (FK), `responder_account_id`
(FK `tb_user_account`), `created_at`, UNIQUE on `(tb_panic_alert_id,
responder_account_id)`. Deliberately NO FK to
`tb_responder_pool_membership`: a membership revoked later must not
invalidate the historical fact that this responder WAS a recipient at
trigger time. `GET /app-panic/alerts` is a lookup against this table —
never a live membership re-check — so a responder approved AFTER an
alert fired never sees it retroactively.

`panic.dispatch` was already seeded by migration `022_legal_gate.sql` at
the capability catalog's founding (it sat in `PENDING_WIRING` since);
migration 046 wires no new seed row — it only removes the
`PENDING_WIRING` entry in `shared/legal/capabilities.ts`, backed by
`panic-alert.service.ts` now calling `assertCapability`.

The runner is forward-only; the rollback is a comment in the migration
file (`DROP TABLE tb_panic_alert_recipient`, `DROP TABLE
tb_panic_alert` — the capability row predates this migration and is not
this migration's to remove).

## Error codes added (`shared/errors/error-codes.ts`, decisions 80/83)

| code | HTTP | when |
|---|---|---|
| `PANIC_ALERT_ACTIVE` | 409 | the (identified) caller already has an unresolved alert (198) |
| `PANIC_ALERT_ALREADY_RESOLVED` | 409 | `resolve` called twice on the same alert (197) |

`LEGAL_BLOCKED` (451), `NOT_FOUND` (404) and `VALIDATION_FAILED` (422)
are reused, same posture as chat/ratings.

## Tests

`responder-pool.controller.spec` (the removed admin-plane `POST` now
404s even with a valid admin token), `responder-pool-app.routes.spec`
(the new `/app-panic/responder-pool` `POST`: 201 with `req.appAccountId`
forwarded — never `req.user`; 401 anonymous; 401 on a panel/forged token;
never mounted under `/api`), `responder-pool.service.spec` (unchanged
behavior, comment updated), `panic-alert.service.spec` (idempotent
replay recomputes `recipientCount`; identified vs anonymous trigger;
empty-pool trigger still 201; cooldown fires only for an identified
caller and never for anonymous; gate ordering and 451 with no write;
accountability only for the anonymous triggerer, never blocking;
`listAlertsForResponder` distance rounding and no raw lat/lng; resolve
ownership by account/clientKey, 404 for non-owner/missing, 409 on double
resolve), `panic-alert.repository.spec` (every SQL contract: idempotency
lookup, cooldown lookup gated on `status='active'`, insert-then-read-back,
bulk recipient insert incl. the empty-array no-op, atomic resolve WHERE
clause, the inbox JOIN/cursor/order), `panic-alert.routes.spec` (full
HTTP surface: 201/200/409/422/451/401/404/400 envelopes, the extra
`message` field in the trigger body is accepted and ignored — never
stored or echoed, cursor forwarding, never mounted under `/api`),
`capabilities.catalog.spec` (`panic.dispatch` WIRED and still correctly
seeded, no duplicate seed row).

## Deliberately out (this round, decisions 193/194/199)

- **Trusted-contact recipient mode** (decision 64's second delivery mode)
  — no table, field, or endpoint. `AlertRecipient` has exactly one
  member this round: the responder pool.
- **Activated/highlighted accessibility level** (decision 63) — no
  per-user panic configuration/opt-in screen, no recipient
  configuration. PP1 only builds the "cold" trigger (65): straight to
  the responder pool, no prior configuration needed or possible.
- **PP2 — mobile (standard)**: the menu entry, the panic button and its
  confirmation, the "Alerts" responder screen (polling), the (now
  reachable) responder-request flow. Not touched here.
- **PP3 — mobile (advanced)**: not built this round (194 removed the
  activated/highlighted mode from scope) — a future vision.
- **PP4 — panel**: likely empty — the approval queue already exists and
  does not change (190 kept the judgment free-form); confirm once PP1/PP2
  ship whether anything is left to build.
- Automatic dispatch to authorities (53) — out of MVP scope, unchanged.
- Push notifications — out of scope project-wide; polling only (192).
- Retention/purge policy for `tb_panic_alert` — no rule decided this
  round; `purgeExpiredReports` never touches this table (no accidental
  coupling — the two aggregates share no code path).

## Status

- PP1 — API side DONE 2026-09-04 (uncommitted; awaiting review, migration
  046 applied in dev after). Suite and `tsc` green.
