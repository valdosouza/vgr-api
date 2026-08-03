# Reports — R1 (SubmitReport)

Decisions 134-142 (`AI/docs/decisions/VGR-plano.md`); plan in
`AI/docs/plans/plano-denuncia.md`; spec tasks 01-03 as amended (E1-E8 block
in `docs/specs/vgr/003-api-tactical-design.md`). R1 ships submission only —
feed (R2), lifecycle/freeze (R3) and media attach (R4) come next.

## Route (app plane — amendment E1)

`POST /app-reports` behind `optionalAppAuth` (promoted to
`gateway/optional-app-auth.middleware.ts`): a bare request is anonymous
(decisions 32/123 — the core promise), a PRESENT-but-invalid token is 401.

Body: `clientKey` (UUID, idempotency — decision 137), `category` XOR
`freeTag` (decision 9), `subject` (mandatory second axis — decision 140,
`other` is the one-tap fallback), `detailFields` (validated against the
category's admin schema — decision 47), `position` (exact lat/lng —
decision 7; **never leaves the API**, decision 135), `anonymous` (explicit
choice — decision 32).

Answers `201 {reportId, status}` on first accept, `200` with the SAME
report on an offline-queue replay (decisions 28/137) — including the race
of two replays (unique `client_key`, ER_DUP_ENTRY resolves to the winner).

## Service order (reports.service.ts)

1. **Idempotency first**: a replay is answered before any re-judging.
2. **Legal Gate before any write**: anonymous submission (no account OR
   logged-in choosing anonymity) consumes `report.anonymous` via
   `assertCapability` — wired in R1, removed from `PENDING_WIRING` (the
   catalog partition spec enforces the swap). Blocked → 451 LEGAL_BLOCKED.
3. **Category form validation** (decision 47) with field-level codes.
4. Insert + timeline `created` (decision 19, append-only) +
   accountability entry for anonymous actors (decision 23 — IP
   envelope-encrypted; never the position). An accountability write
   failure is logged but never takes the report down (decision 123).

Anonymity is social, not forensic: a logged-in reporter choosing
anonymity keeps `reporter_account_id` internally with `anonymous='S'`.

## Taxonomy (decisions 3/9/140 — in CODE, decision 140d)

`CATEGORIES` (12: spec list ∪ inherited icons, canonical English) and
`SUBJECTS` (9, `child` keys the decision-25 retention; `other` fallback)
in `reports.interface.ts`. Admin-managed registry is a future evolution.

## Shared promotions (amendment E8)

- `shared/audit/accountability.ts` — moved from modules/identity (which
  re-exports); second caller forced the move.
- `shared/risk/category-form.ts` — read path + TTL cache + validation;
  risk-config keeps the admin CRUD and invalidates the ONE cache on write.

## Storage (migration 030)

`tb_report` (client_key unique; taxonomy XOR CHECK; exact lat/lng;
anonymous flag; status open|resolved; `expires_at`/`frozen` ready for
R3/decision 141) and `tb_report_timeline` (append-only, no soft-delete).

## Lifecycle (R3 — decisions 18/19/50/131/135/141/142)

Ownership is the account OR the report's `clientKey` presented in the
`x-client-key` header (bearer-secret pattern of decision 134 — the
anonymous reporter's app kept the key it generated; header, never URL).

- `PUT /app-reports/:id` — owner edits their own words (freeTag on
  free-tag reports, detailFields re-validated against the category form).
  Taxonomy axes and position are immutable; resolved and FROZEN cases are
  untouchable (141 — evidence in an authority's hands). Timeline `edited`
  with changedFields (19). Non-owners get 404, never 403.
- `POST /app-reports/:id/resolve` — atomic transition (0 rows = already
  resolved); stamps `expires_at = +90 days` (131); helpers stay linked and
  the timeline `resolved` event is their in-app closure notice (18).
- `GET /app-reports/:id` — GetReportVisibility (50): owner gets
  everything plus the offers list (helper identity only when the helper
  chose it AND tier isn't high — 6/40/60; timestamps never on high tier —
  41); an identified helper with an offer is a participant (full view, no
  offers list); anyone else gets the tier-DEGRADED public view on open
  cases (same `shared/geo/degrade` grid as the feed — the sharper surface
  would betray the position) or the closure summary on resolved ones.

## Help offers (`/app-help-offers`, decisions 10/20/34/35)

Anonymous offers accepted in full (35, accountability trail 23);
self-dealing rejected (20); one identified offer per report (dup = 409);
no NEW offers after resolution (18 keeps only existing links); the
timeline event carries the help type and never the helper identity.

## Case freeze (`/api/case-freeze`, decisions 141/142 — panel plane)

The ONE panel surface this front adds: `GET /:id` state,
`POST /:id/freeze` (one human, MANDATORY reason — writ/case number),
`POST /:id/unfreeze-request` + `POST /:id/unfreeze-approve` (DISTINCT
users — unfreezing re-arms destruction, dual-control pattern of 45/107).
Unfreezing a resolved case restarts the 90-day clock; an open case keeps
no expiry until resolution. Freeze writes NO timeline event (it would tip
off a reporter under investigation) — the record is the audit row (116).
Purge job (`report-purge`, hourly at :30): nulls detail fields, exact
position, free-tag text and timeline payloads of expired unfrozen cases,
keeping the statistical skeleton (25/131).

## Tests

`reports.service.spec` (gate order, decision-32 choice, replay, dup race,
form 47, accountability resilience), `reports.routes.spec` (anonymous
end-to-end, 451, XOR, mandatory subject, invalid-token 401),
`reports.lifecycle.spec` (ownership by clientKey, frozen untouchable,
retention stamp, visibility tiers, masking, dual-control unfreeze, purge),
`help-offers.service.spec` (anti-fraud, 409, identity-free timeline),
`case-freeze.routes.spec` (grants, audit, plane separation), plus the
risk-config spec adapted to the shared read path. 53 suites / 333 tests.
