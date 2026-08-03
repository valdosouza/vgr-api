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

## Tests

`reports.service.spec` (gate order, decision-32 choice, replay, dup race,
form 47, accountability resilience), `reports.routes.spec` (anonymous
end-to-end, 451, XOR, mandatory subject, invalid-token 401), plus the
risk-config spec adapted to the shared read path. 47 suites / 282 tests.
