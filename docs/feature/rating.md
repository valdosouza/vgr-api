# Helper rating — RT1 (API)

Decisions 48, 178-189 (`AI/docs/decisions/VGR-plano.md`, round 13); plan
in `AI/docs/plans/plano-rating.md`; spec task 26 / `HelperRating`,
`RatingScore`, `RateHelper`, `HelperRated`, `HelperRatingRepository` in
`docs/specs/vgr/003-api-tactical-design.md` (amended 2026-09-03). Module
`src/modules/ratings/` — the HelperRating aggregate of Identity & Trust
got its own module because `modules/identity` has no router by design.
RT2 (mobile: resolve from the app, rating screen, "my reputation") and
RT3 (panel: the score per offer on the case detail, decision 186) are
NOT here — see "Deliberately out" below.

Invariants (each has a test):

- **The score lands on the helper's INTERNAL identity (48/180)**: only
  an offer whose helper holds an account (`tb_help_offer.helper_account_id
  NOT NULL`) is ratable — even one who chose anonymity toward the reporter
  (`anonymous = 'S'`), because the account is always recorded when it
  exists (23/32). A helper without an account has no identity to
  accumulate on: 422 `RATING_NOT_ALLOWED`; the app warns them before they
  offer (RT2, the same warning as the chat's 169).
- **Nothing about the helper leaves the API (48/60/185)**: the rating
  payloads carry ids and the score; the owner's view shows of the helper
  exactly what the offer already showed (6/40/60); no user ever reads
  another user's reputation; there is no `/app-ratings/:id`.
- **Only after resolution, until the purge (181)**: an open case answers
  409 `RATING_CLOSED` with `params.reason = 'open'`; a hidden case (162)
  `'hidden'`. Rating is never mandatory ("a denúncia nunca espera", 123).
  A frozen case (141) changes nothing.
- **One rating per offer, immutable (183)**: `tb_helper_rating` is UNIQUE
  on the offer; a second attempt is 409 `ALREADY_RATED`; a replay of the
  SAME `clientKey` answers the same rating (137). No PUT, no DELETE.
- **The helper sees only their own aggregate (184)**: `{ count, average }`,
  `average` null below the k = 5 floor of `shared/stats/k-anonymity`
  (164/165) — with fewer ratings the average IS the individual score, and
  "case X gave me 1" points at the reporter (6/40). Never per case.
- **Reputation is not evidence (187)**: the row holds ids and a score —
  the purge (25/131) never touches it; a rating whose case is currently
  hidden leaves the aggregate (JOIN at read time) and comes back when the
  case is unhidden.
- **Legal Gate (188)**: `helper.rating` is asserted before the insert —
  blocked → 451 `LEGAL_BLOCKED`, nothing written. Born WIRED (the catalog
  partition spec proves it).

## Plane and routes (`helper-rating.routes.ts`)

App plane, never `/api`. Two routers because the two routes live on two
prefixes:

| Route | Who | Answers |
|---|---|---|
| `POST /app-reports/:reportId/offers/:offerId/rating` body `{ score: 1..5 (integer), clientKey: UUID }` | the report OWNER — account, or the anonymous reporter presenting the report's `clientKey` in the `x-client-key` HEADER (134/137); `optionalAppAuth` | `201 Rating` first accept; `200 Rating` replay of the same `clientKey`; `400 INVALID_ID`; `404 NOT_FOUND` (non-owner, missing/purged report, offer of another report — never 403); `409 RATING_CLOSED { reason: 'open' \| 'hidden' }`; `409 ALREADY_RATED`; `409 DUPLICATE` (clientKey spent on another offer — an app bug); `422 VALIDATION_FAILED` (`fields[].field = 'score' \| 'clientKey'`); `422 RATING_NOT_ALLOWED`; `451 LEGAL_BLOCKED`; `401` on a PRESENT but invalid token |
| `GET /app-ratings/me` | an authenticated app account — `appAuthMiddleware`, never optional | `200 { count, average }`; `401 UNAUTHORIZED` |

```
Rating { ratingId, reportId, helpOfferId, score, createdAt: ISO }
```

**Mount strategy (app.ts)**: `reportRatingRoutes` is a
`Router({ mergeParams: true })` mounted on the FULL path
`/app-reports/:reportId/offers/:offerId/rating` — the mechanism
`gateway/router.ts` uses for the chat evidence read (C3) — and registered
BEFORE the `/app-reports` mount, so the request is rate-limited once and
the reports router never sees it; the default router is mounted at
`/app-ratings`. Neither module imports the other: the rating facet on the
owner's report view (below) is SQL over `tb_helper_rating` inside
`reports.repository`, exactly like the chat summaries of C1.

**Replay convention**: the reports.submit convention (137) — same body,
`200` on replay, `201` on the first accept; no `replayed` flag in the
payload (the chat adds one; reports does not, and this is a reports-side
act).

## Service order (`helper-rating.service.ts rateHelper`)

Ordering encodes the principles, as `submitReport` and the chat `post()`
do:

1. **Ownership (134)** — `owns()` exactly as `reports.service`: account
   match OR the bearer `clientKey`. Missing, purged or foreign report →
   404; then the offer by id AND report id → 404.
2. **Idempotency (137/183)** — the offer's existing rating answers a
   replay of the same `clientKey` as-is (`200`), even if the case was
   hidden since: a flaky network is never punished. A DIFFERENT
   `clientKey` on a rated offer → 409 `ALREADY_RATED` (the permanent
   truth, before any state check).
3. **Case state (181/162)** — not resolved → 409 `RATING_CLOSED`
   `'open'`; hidden → `'hidden'`.
4. **Helper without an account (180)** → 422 `RATING_NOT_ALLOWED`.
5. **Legal Gate (188)** — `assertCapability('helper.rating', { userRef:
   account | undefined, ip })` → 451 before any write.
6. **Append** — `insertRating` returns null when a UNIQUE key collided
   (the offer's: another rating won the race; the clientKey's: a replay
   racing itself); the service re-reads the offer's rating: same
   `clientKey` → replay, another → `ALREADY_RATED`, none → the clientKey
   was spent on another offer → 409 `DUPLICATE`.
7. **Accountability (23)** — the ANONYMOUS owner leaves
   `helper_rating.submit` with `{ ratingId }` (never the score), logged on
   failure, never blocking (123) — the pattern of `help_offer.submit`. An
   owner with an account leaves no entry: the session is the trail.

`getMyReputation(accountId)`: `aggregateByHelperInternalId` → `count`
always; `average` rounded to 2 decimals when `count >= K_ANONYMITY_FLOOR`
(5), else null.

## Storage (migration `045_helper_rating.sql`)

`tb_helper_rating`: `id`, `tb_help_offer_id` (FK, UNIQUE), `tb_report_id`
(FK, KEY), `helper_account_id` (FK `tb_user_account`, NOT NULL, KEY — the
aggregate reads by helper), `score TINYINT` CHECK 1..5, `client_key`
CHAR(36) UNIQUE, `created_at`, `deleted` (house convention only — no
delete path exists). The (report, helper) pair is deliberately NOT a key:
a rating is per OFFER, and the offer already carries the pair. Plus the
`tb_legal_capability` row `helper.rating` (module `ratings`), pattern of
033/043. The runner is forward-only; the rollback is a comment in the
file.

`aggregateByHelperInternalId`:

```sql
SELECT COUNT(*) AS count, AVG(r.score) AS average
FROM tb_helper_rating r
JOIN tb_report p ON p.id = r.tb_report_id AND p.hidden = 'N'
WHERE r.helper_account_id = ? AND r.deleted = 'N'
```

## Propagation into reports

- `GET /app-reports/:id` OWNER view: every entry of `offers[]` gains
  `rating: { score: number | null, ratable: boolean }` — `ratable` =
  the case is resolved AND not hidden AND the offer's helper has an
  account AND no rating exists yet. `findOffersWithNames` LEFT JOINs
  `tb_helper_rating` (one query; the raw `helperAccountId` / `ratingScore`
  columns never serialize). Participant, public and summary views carry
  NO rating data (185) — asserted by test.
- `purgeReport` is untouched; a test asserts its statement set never
  names `tb_helper_rating` nor `tb_help_offer` and never DELETEs (187).

## Error codes added (`shared/errors/error-codes.ts`, decisions 80/83)

| code | HTTP | when | params |
|---|---|---|---|
| `RATING_NOT_ALLOWED` | 422 | the offer's helper has no account (180) | — |
| `RATING_CLOSED` | 409 | the case is not resolved yet, or is hidden (181/162) | `{ reason: 'open' \| 'hidden' }` |
| `ALREADY_RATED` | 409 | the offer already has a rating under another clientKey (183) | — |

## Tests

`helper-rating.service.spec` (ownership by account and by key, 404 for
the helper/stranger/purged, offer of another report, no-account 422,
anonymous offer rated against the account, open/hidden 409 with reason,
ALREADY_RATED, replay even after hiding, stored score on replay, both
UNIQUE races, DUPLICATE on a reused key, gate ordering and 451 with no
write, accountability only for the anonymous owner and never blocking,
payload free of `helperAccountId`/`clientKey`; reputation floor,
rounding, empty aggregate, keys), `helper-rating.routes.spec` (201/200
shapes, header vs URL, 404 matrix, 409/422/451 envelopes with `params`,
score 0/6/4.5/"5"/missing and a non-UUID key as 422 on the right field,
400 ids, 401 on a forged token, no PUT/DELETE, the reports routes still
answer on their paths, never under `/api`; `/me` 401 anonymous, floor,
rounding, no `:id` route), `helper-rating.repository.spec` (every SQL
contract, `ER_DUP_ENTRY` → null, hidden JOIN, string→number, no
update/delete export), `reports.lifecycle.spec` (the `rating` facet per
state and per access level), `reports.repository.spec` (purge never
reaches the rating; the LEFT JOIN), `capabilities.catalog.spec`
(`helper.rating` WIRED and seeded).

## Deliberately out (this phase)

- **RT2 — mobile** (`D:\ProjetoVGR\app`): the "resolve" button and the
  rating screen after it, the offline-queue tasks `report_resolve` /
  `rating_submit`, "my reputation" in the account area, the widened
  no-account warning (180). Not touched here.
- **RT3 — panel** (decision 186): the score per offer on the case detail
  under the existing `reports` VIEW; no aggregate-per-helper screen.
- Trust weight of decision 27 (189): the aggregate is readable, the
  formula belongs to the direction-sightings round.
- Text comments, ratings visible to other users, the helper rating the
  reporter, a resolution "outcome" field: registered as visions in the
  plan, not built.

## Status

- RT1 — API side DONE 2026-09-03 (uncommitted; the orchestrator reviews,
  commits and applies migration 045 in dev). Suite and `tsc` green — see
  the delivery report for the counts.
