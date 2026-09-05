# Direction sighting — DS1 (API)

Decisions 200-207 (`AI/docs/decisions/VGR-plano.md`, round 15), closing
the original 22/26/27/28; plan in
`AI/docs/plans/plano-direction-sightings.md`; spec `DirectionEstimate`,
`DirectionSighting`, `SightingWeight`, `Direction`, `LogDirectionSighting`,
`ReconcileDirectionEstimate`, `DirectionEstimateRepository` in
`docs/specs/vgr/003-api-tactical-design.md` (amended 2026-09-04). Module
`src/modules/direction-sightings/`. DS2 (mobile: compass widget, detail
card) and DS3 (panel — empty, decision 201 chose the hardcoded pattern
with no admin screen) are NOT here — see "Deliberately out" below.

A community member near an OPEN report whose category involves a fleeing
subject (a robbery suspect, a kidnapper, a missing person/pet) taps which
of 8 compass directions they saw it go. The API reconciles every such
sighting for that report into a single weighted estimate, SYNCHRONOUSLY,
in the same request. Once enough sightings exist, everyone who can see
that open report — including anonymous public feed viewers — sees the
single most-likely direction. Below that floor, nobody sees anything,
specifically so the fleeing party can't tell they're being tracked.

Invariants (each has a test):

- **Synchronous, never batched (22)**: the sighting's own response already
  carries the reconciled estimate — `logDirectionSighting` computes and
  returns it in the same request/response cycle, no queue.
- **Weighted reconciliation, never a majority vote (26)**: the winning
  direction is whichever has the highest ACCUMULATED WEIGHT, not the most
  raw sightings — a test proves 3 anonymous sightings for one direction
  are outweighed by 2 identified sightings for another. A tie is broken
  by whichever direction was reported FIRST for that report
  (deterministic, documented — `pickWinningDirection`,
  `shared/direction-sighting/direction-estimate.ts`).
- **Identified weighs more than anonymous, never refused for it (27)**:
  `SIGHTING_WEIGHT_IDENTIFIED` (default 1.0) vs `SIGHTING_WEIGHT_ANONYMOUS`
  (default 0.5) — an anonymous sighting is stored at a lower weight, never
  rejected for being anonymous.
- **Offline queue (28)**: `client_key CHAR(36) UNIQUE` makes a sighting
  replay-safe (137) — a replay of the same key returns the SAME sighting
  and its CURRENT estimate, never a duplicate row. Unlike
  `tb_report`/`tb_panic_alert`, this key is ONLY an idempotency key — a
  sighting is append-only, never resolved/edited later, so it never
  doubles as a bearer secret for a future action.
- **Category eligibility fixed in code (201)**: `robbery`, `kidnapping`,
  `fugitive`, `missing` — exactly `dynamic-radius.ts`'s (`modules/
  help-matching/dynamic-radius.ts`) "things that move" subset
  (`growthKmPerHour > 0`). No DB, no cache, no admin screen — this is why
  DS3 stays empty.
- **Disclosure floor, env-configurable (202)**: `DIRECTION_SIGHTING_MIN_COUNT`
  (default 5) — a report needs at least this many sightings TOTAL, summed
  across every direction, before any READ path exposes an estimate. This
  is a floor, not a vote-count check on the winning direction specifically.
- **Only the single direction, never the distribution, never the raw count
  (203)** — on any READ path (report detail, feed). See the one
  deliberate asymmetry in the write response, below.
- **Exposed to everyone who can see the open report (204)**: the owner's
  view, a participant's view, AND the anonymous public feed/detail view.
  NEVER on the `summary` tier (a resolved report seen by a non-participant)
  — that tier already carries no other detail.
- **Self-dealing (200, mirrors help-offers.service.ts's decision-20
  posture EXACTLY)**: the reporter cannot sight their own report — but
  this ONLY compares an IDENTIFIED sighter's account id against the
  report's `reporterAccountId`. A fully anonymous actor is covered by the
  accountability log (23), not by this check — deliberately, not an
  oversight. An anonymous caller presenting the report's OWN `client_key`
  as their sighting's `clientKey` is NOT blocked either: the sighting's
  `clientKey` has no relationship to report ownership (see the storage
  note below), and building that comparison would be new, unrequested
  scope (the exact gap help-offers already documents for itself).
- **Legal Gate (`location.tracking`, decisions 7/22/26)**: asserted before
  any insert — blocked → 451 `LEGAL_BLOCKED`, nothing written. The
  capability was declared and seeded by migration 022 at the catalog's
  founding and sat in `PENDING_WIRING` until this delivery removes it (the
  catalog partition spec proves it).
- **Reputation weighting deliberately NOT wired this round (206)**: the
  weight is EXACTLY the identified-vs-anonymous multiplier (27/205),
  nothing else. `ratings`' `GET /app-ratings/me` aggregate is never read
  here. This closes the promise decision 189 left open ("the fórmula
  nasce na rodada de direction sightings, quando houver consumidor") by
  explicitly declining to wire it yet — a future refinement, not a gap.

## Plane fix — `POST /app-direction-sightings` (not a new decision, a correction)

The DDD spec (`003-api-tactical-design.md`) sketched `POST
/api/direction-sightings` — written before the two-plane split (decision
119) existed. Today `/api` is globally gated by `authMiddleware` requiring
an ADMIN JWT (`src/app.ts`, `app.use('/api', authMiddleware)`;
`src/gateway/auth.middleware.ts` checks `audience: Audiences.ADMIN`) — a
real mobile witness has no admin token and could never reach that route.
This is the exact same class of bug PP1 already found and fixed for the
responder-pool's `POST` (`docs/feature/panic.md`'s own "Plane fix"
section).

Fixed in DS1 from the start: the endpoint is mounted on the APP plane —
`POST /app-direction-sightings`, guarded by `optionalAppAuth` (anonymous
allowed, per decision 200). The spec's route sketch is amended in
`003-api-tactical-design.md`/`004-api-test-scenarios.md` to reflect the
corrected plane, noted there as a correction, not a new decision — same
framing as panic's plane-fix note.

## Route shape — flat, not nested (a design choice, reasoned)

`POST /app-direction-sightings` is a FLAT top-level route (body carries
`reportId`), NOT nested under `/app-reports/:reportId/direction-sightings`
the way the rating module nests under `/app-reports/:reportId/offers/
:offerId/rating` via the `mergeParams` mount trick
(`helper-rating.routes.ts`'s `reportRatingRoutes`, mounted in `app.ts`
BEFORE the more general `/app-reports`).

The rating module needed nesting because a rating attaches to a specific
SUB-RESOURCE of a report — one help OFFER (`offerId` is itself a path
segment one level below the report). A direction sighting has no such
sub-resource id: it attaches directly to the report, exactly like a help
offer does (`POST /app-help-offers` with `reportId` in the body, no
nesting) — so the flat shape mirrors `help-offers.routes.ts`, not
`helper-rating.routes.ts`.

## Plane and routes

App plane, never `/api`.

| Route | Who | Answers |
|---|---|---|
| `POST /app-direction-sightings` body `{ reportId, direction, clientKey: uuid }` | any viewer of the open report — `optionalAppAuth` — except the report's own IDENTIFIED reporter (200) | `201 { sightingId, reportId, estimate, count }` first accept; `200` (same shape) replay of the same `clientKey`; `404 NOT_FOUND` missing report; `422 DIRECTION_SIGHTING_NOT_ELIGIBLE` (category); `422 BUSINESS_RULE` (resolved report, or self-dealing); `451 LEGAL_BLOCKED`; `422 VALIDATION_FAILED`; `401` on a PRESENT but invalid token |

## Response shape — a deliberate write/read asymmetry (decisions 22/203)

The WRITE response (`POST /app-direction-sightings`) carries a bit MORE
than any READ path ever does, because it is private feedback to the actor
who just acted, not a public signal:

```json
{ "sightingId": 501, "reportId": 7, "estimate": "N", "count": 6 }
```

- `estimate` (`Direction | null`) is the single winning direction —
  NEVER the underlying probability distribution (203's minimal-disclosure
  principle applies here too).
- `count` (total sightings so far, any direction) exists ONLY in this
  response — never on a READ path.
- **Neither field is gated by the disclosure floor (202)** — the actor
  who just submitted sighting #1 gets an immediate, synchronous
  `estimate`/`count` (decision 22's own scenario: "should log ... and
  return the updated estimate synchronously"). The floor (202) governs
  READ paths' PUBLIC disclosure — the report detail view and the feed —
  never the submitter's own private, synchronous feedback. This is a
  documented asymmetry, not a contradiction: do not "fix" it into gating
  the write response by the floor.

The READ facet (report detail view, feed item) is ONLY:

```json
{ "direction": "N" }
```

— or `null` below the floor / for an ineligible category. No count, no
distribution, ever (203).

## Reconciliation algorithm (decision 26)

`shared/direction-sighting/direction-estimate.ts` — promoted to shared
the same way `Category`/`Subject` (`shared/taxonomy/taxonomy.ts`) and
`haversineKm`/`degradePosition` (`shared/geo/degrade.ts`) were: THREE
modules need the identical, pure algorithm — direction-sightings (writes
and owns the aggregate; needs it for its own synchronous write response),
`reports` (report-detail facet) and `help-matching` (feed facet).

- `pickWinningDirection(rows)`: the direction with the highest
  `totalWeight` wins; a tie is broken by whichever direction has the
  EARLIEST `firstReportedAt` for that report — deterministic and
  documented, never insertion order or a random pick.
- `totalSightingCount(rows)` / `meetsDisclosureFloor(rows, minCount)`:
  sums `sightingCount` across EVERY direction row of the report (never
  just the winner's own count) and compares to the env-configured floor
  (202).
- There is NO 50/50-prior field stored anywhere: the "even 50/50 between
  the first two reported directions" of decision 26/the plan's §1 falls
  out naturally from equal-weight accumulators before a third sighting
  ever shifts the balance — the algorithm does not special-case "exactly
  two directions", it generalizes to N directions from the start (the
  plan explicitly allows a third+ direction to enter later).

## Storage (migration `047_direction_sighting.sql`)

`tb_direction_sighting` — the append-only log, one row per logged
sighting: `id`, `tb_report_id` (FK), `direction VARCHAR(2)` CHECK
(8-point compass), `weight DECIMAL(3,2)` (the RESOLVED 27/205 multiplier
AT LOGGING TIME — stored, never recomputed if the env var changes later),
`account_id INT NULL` (FK `tb_user_account`, NULL for anonymous),
`client_key CHAR(36) UNIQUE` (replay-safety ONLY — see the invariant
above), `created_at`.

`tb_direction_estimate` — the materialized aggregate, one row per
(report, direction): `total_weight`, `sighting_count`,
`first_reported_at` (stamped ONLY at the row's creation — the tie-break
key), updated INCREMENTALLY via `ON DUPLICATE KEY UPDATE` on every insert
so reconciliation stays O(1) rather than replaying every past sighting —
the same requirement decision 22's "synchronous" demands. Both writes
(the log insert and the aggregate upsert) happen in ONE transaction
(`direction-sightings.repository.ts`'s `insertSighting`, mirrors
`chat.repository.ts`'s `insertThreadWithParticipants`).

`location.tracking` was ALREADY seeded in `tb_legal_capability` by
migration `022_legal_gate.sql` at the catalog's founding (it sat in
`PENDING_WIRING` since, citing "decisions 7, 22, 26" verbatim) — the
exact same finding PP1 made for `panic.dispatch` in migration 046.
Migration 047 does NOT re-insert it — it only removes the
`PENDING_WIRING` entry in `shared/legal/capabilities.ts`, backed by
`direction-sightings.service.ts` now calling `assertCapability`.

## Service order (`direction-sightings.service.ts logDirectionSighting`)

Ordering encodes the product's principles, as `submitReport`/help-offer/
panic-alert/`rateHelper` do:

1. **Idempotency first (28/137)** — `findSightingByClientKey`: a replay
   of the same `clientKey` answers the SAME sighting with its CURRENT
   estimate (recomputed, since more sightings may have landed since).
2. **Report must exist (404)** — existence is information (55).
3. **Category eligibility (201)** — 422 `DIRECTION_SIGHTING_NOT_ELIGIBLE`.
4. **Report must be OPEN (422 `BUSINESS_RULE`)** — help-offers' exact
   wording style ("Report is already resolved").
5. **Self-dealing (200)** — 422 `BUSINESS_RULE`, mirrors
   `help-offers.service.ts`'s `submitHelpOffer` EXACTLY: identified-only.
6. **Legal Gate (451)** — `location.tracking`, before any write.
7. **Resolve the weight (27/205)** from env, insert (one transaction).
8. **Accountability (23)** for the anonymous sighter, never blocking
   (123) — pattern of `help_offer.submit`.
9. **Synchronous reconciliation (22)** — the response already carries
   `estimate`/`count`, ungated by the floor (202 governs READ paths only).

## Report view / feed facet wiring

- `reports.repository.ts`'s `getDirectionEstimateFacet(reportId)` — SQL
  over `tb_direction_estimate` is table access, not a module import (same
  posture as the chat/rating facets already there). Called from
  `reports.service.ts`'s `getReportView` in the `public` branch AND the
  `owner`/`participant` branch — NEVER in `summary` (204).
- `help-matching.repository.ts`'s `findDirectionEstimates(reportIds)` —
  ONE batched query (`WHERE tb_report_id IN (...)`) for the whole feed
  page, never one per row (mirrors the risk-tier lookup's per-distinct-
  category discipline already in `listNearbyReports`). Skipped entirely
  for an empty page.
- Both READ paths reuse the SAME shared `pickWinningDirection`/
  `meetsDisclosureFloor` functions — the algorithm itself is never
  duplicated, only the SQL that feeds it (which is genuinely
  module-specific: one report vs. a batched `IN (...)`).

## Error codes added (`shared/errors/error-codes.ts`, decisions 80/83)

| code | HTTP | when |
|---|---|---|
| `DIRECTION_SIGHTING_NOT_ELIGIBLE` | 422 | the report's category is not one of the fixed "things that move" set (201) |

`BUSINESS_RULE` (422, resolved report / self-dealing, help-offers'
posture), `LEGAL_BLOCKED` (451), `NOT_FOUND` (404) and `VALIDATION_FAILED`
(422) are reused, same posture as help-offers/chat/ratings/panic.

## Tests

`shared/direction-sighting/__tests__/direction-estimate.spec.ts` (the
pure reconciliation algorithm: weighting over counting, deterministic
tie-break, the floor); `direction-sightings.repository.spec.ts` (SQL
contracts: idempotency lookup, the one-transaction insert + O(1)
aggregate upsert with `first_reported_at` untouched by the UPDATE clause,
rollback on failure, the accumulator read); `direction-sightings.
service.spec.ts` (category eligibility accept/refuse; self-dealing
identified-only, including the documented anonymous-with-the-report's-
own-clientKey non-block; report-must-be-open; idempotent replay;
weighting — 3 anonymous outweighed by 2 identified; the floor never
gates the write response; Legal Gate ordering and 451 with no write;
accountability only for the anonymous sighter, never blocking);
`direction-sightings.routes.spec.ts` (full HTTP surface: 201/200/404/
422/451/401 envelopes, never mounted under `/api`); `reports.repository.
spec.ts`/`reports.lifecycle.spec.ts` (the facet in `public` and `owner`/
`participant`, absent from `summary`, floor-respecting); `help-matching.
repository.spec.ts`/`help-matching.service.spec.ts` (the batched feed
facet, exactly one query per page regardless of page size, weighted
winner over raw majority); `capabilities.catalog.spec.ts`
(`location.tracking` WIRED and still correctly seeded, no duplicate seed
row).

## Deliberately out (this round, decisions 206/207)

- **Reputation-weighted trust (206)** — the weight is exactly the
  identified/anonymous multiplier (27/205); `ratings`' aggregate is never
  read here. Closes decision 189's open promise by explicitly declining,
  not by omission.
- **DS2 — mobile**: the `VgrCompass` widget, the report-detail card with
  the sighting button (gated by eligible category client-side too), the
  offline queue item (`direction_sighting_submit`). Not touched here.
- **DS3 — panel**: likely EMPTY — decision 201 chose the hardcoded
  eligibility pattern with no admin screen (same outcome as panic's PP4).
  Confirm once DS1/DS2 ship whether anything is left to build.
- Trajectory prediction + proactive push notification (decision 11,
  already closed as out of MVP — not reproposed).
- Reward eligibility for a sighting (nothing in the original vision
  suggests this; sighting is not one of decision 10's help types).
- Revoking/editing an already-logged sighting — a sighting is a one-way,
  append-only signal by design (the plan's own §6).

## Status

- DS1 — API side DONE 2026-09-04 (uncommitted; awaiting review, migration
  047 applied in dev after). Suite and `tsc` green.
