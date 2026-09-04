# Report moderation on the panel — front 142

Decisions 158-167 (`AI/docs/decisions/VGR-plano.md`, round 11); plan in
`AI/docs/plans/plano-moderacao-painel.md`. Five phases in the order
B1 → B2 → B4 → B3 → B5 (decision 158). The app-plane report itself is
`docs/feature/reports.md`; freeze/unfreeze stay on `/api/case-freeze`
(decision 141) and are only EMBEDDED by the detail screen.

Invariants every phase keeps (tested):

- The EXACT position never leaves the API except through the audited
  `GET /api/reports/:id/position` behind its own grant (135/159).
- An anonymous report carries NO identity on the panel — never the
  internal `reporter_account_id` (23), never the `clientKey`, never an
  e-mail; an identified one only `{ accountId, displayName }` (160).
  Helpers in offers follow the same rule.
- Enforcement per endpoint with `requirePrivilege` (72); screens only
  disable buttons.
- The case's masked CHAT is read on this same path — `GET
  /api/reports/:id/chat` — under its own no-bootstrap grant
  `chat_evidence` stacked on `reports` VIEW, every read audited (decision
  175, C3 of the chat front). The route belongs to the messaging module
  and is mounted from `gateway/router.ts`: see "Panel read (C3)" in
  `chat.md`.

## B1 — search + detail (decisions 159/160/165/166)

Mounted at `/api/reports` (panel plane, behind `authMiddleware`);
files `reports-admin.{dto,service,controller,routes}.ts` plus the panel
queries appended to `reports.repository.ts`.

### Interfaces (migration 038)

- `reports` — kind 'T', group "Operations". VIEW = search + open the
  detail; UPDATE = moderate / mark reviewed (reserved for B2/B3, declared
  now so grants can be prepared — 165). Bootstrap to de-facto admins
  (UPDATE on Users), pattern of 020/021/022/029/032.
- `report_exact_position` — kind 'R', VIEW only, **no bootstrap** (159 —
  same posture as `media_original`): nobody reads the exact point until a
  human grants it.

`InterfaceKeys.REPORTS` / `InterfaceKeys.REPORT_EXACT_POSITION` in
`shared/acl/privileges.ts`.

### `GET /api/reports` — `reports` VIEW, NOT audited (166)

Query (all optional; 422 with per-field codes on bad input, decision 83):
`page` (>=1, default 1), `pageSize` (1..100, default 20), `id`, `status`
(`open|resolved`), `category` (`CATEGORIES`), `subject` (`SUBJECTS`),
`tier` (`low|medium|high` — resolved in the service to the categories
currently in that tier via `shared/risk/getRiskTier`, free-tag rows
included when `getRiskTier(null)` matches), `frozen` / `hasMedia`
(`true|false`; hasMedia = EXISTS on `tb_report_media` joined to living
`tb_media`), `from` / `to` (ISO date-time or `YYYY-MM-DD`; `from`
inclusive; a date-only `to` covers the whole day — bound is the next
midnight UTC compared with `<`; a date-time `to` is inclusive).

Sort `created_at DESC, id DESC`; excludes `deleted='S'`; **includes purged
rows** (statistical skeleton, 25/131). The SQL projection never selects
`client_key` / `reporter_account_id`.

```
200 { items: ReportListItem[], page, pageSize, total }
ReportListItem {
  reportId, category: string|null, freeTag: string|null, subject,
  tier: 'low'|'medium'|'high', status: 'open'|'resolved', anonymous: boolean,
  frozen: boolean, purged: boolean, mediaCount: number,
  position: { lat, lng } | null,      // shared/geo/degrade grid by tier; null when purged
  createdAt: ISO, resolvedAt: ISO|null
}
```

### `GET /api/reports/:id` — `reports` VIEW, audited `read` / `report` / id (166)

404 `NOT_FOUND` when missing or soft-deleted (no audit row on 404). A
purged case answers the skeleton only — nothing beyond `tb_report` is even
queried: `purged: true`, `position: null`, `detailFields: null`,
`reporter: null`, `timeline: []`, `media: []`, `offers: []`.

```
ReportPanelDetail {
  reportId, category, freeTag, subject, tier, status, anonymous,
  frozen, frozenReason, frozenAt, purged, createdAt, resolvedAt, expiresAt,   // timestamps EXACT (the panel is the platform, 60)
  reporter: { accountId, displayName } | null,                              // null when anonymous (160); displayName only, never e-mail
  position: { lat, lng, precisionMeters } | null,                           // degraded grid; precision 110 / 550 / 1100 m from GRID_BY_TIER
  detailFields: object | null,
  timeline: [{ eventType, payload, createdAt }],
  media: [{ publicId, mime, width, height, status }],                       // every living tb_media row incl. blocked/pending (M3)
  offers: [{ helpOfferId, helpType, anonymous, helper: {accountId, displayName}|null, createdAt, ratingScore: number|null }]
}
```

Identified actors are NOT tier-degraded here (decision 60 — the panel is
the platform; 41 protects against the reporter's correlation). The
media list carries publicIds only: the image itself is still served by
`/api/media/:publicId/:variant` under `media_evidence` (130).

`offers[].ratingScore` (RT3, decision 186): the panel observes the score
of any offer already rated by its report owner through the app plane
(`rating.md`, RT1) — `null` until rated. Read-only, under the SAME
`reports` VIEW grant as the rest of this endpoint: no new capability, no
new migration, no new audit event, and no aggregate-by-helper screen
(explicitly excluded by 186). Unlike the owner's own view
(`OfferRatingView` in `reports.md`), the panel gets the bare score only —
no `ratable` flag (the panel never rates) and nothing about who rated
(there is no rater identity to leak; `clientKey` never leaves the app
plane's write path).

### `GET /api/reports/:id/position` — stacked guards, audited `read` / `report_position` / id (159)

`requirePrivilege(REPORTS, VIEW)` THEN
`requirePrivilege(REPORT_EXACT_POSITION, VIEW)` — either grant alone is a
403. `200 { reportId, lat, lng }` with `Cache-Control: no-store` (a cached
read would be an unaudited read); 404 when missing, deleted or purged (the
position is already nulled), with no audit row.

### Tests

`reports-admin.service.spec` (tier -> category resolution incl. the
free-tag null tier, date bounds, list/detail degradation, serialized
output free of `reporterAccountId` / `clientKey` / exact coordinates,
reporter and helper masking, purged skeleton, exact position 404s) and
`reports-admin.routes.spec` (grant per route incl. the stacked position
guard both ways, 422 field codes, audit on detail and position but NOT on
list, 404 not audited, no-store, 401 without token).

## B2 — moderation (decisions 162/163/165/167)

Four acts, ONE rule: **one human holding `reports` UPDATE (165 — no new
interface; declared in 038) + a reason from the fixed catalog + a
`tb_admin_audit` row (116)**. Reverting (unhide/unblock) follows the SAME
rule — nothing here destroys evidence, so no dual control (162; that
friction stays reserved to what re-arms destruction, 141d). Migration
`039_report_moderation.sql`.

Invariants (each has a test):

- **Moderation never touches retention**: `expires_at`, `frozen`, the
  purge job and the media-expiry job are unchanged; the hide/unhide and
  block/unblock statements move ONLY their own columns
  (`reports.repository.spec`, `media.repository.spec`).
- **No timeline event** for any of the four acts (167) — same choice as
  the freeze (141), for a different reason.
- **Hidden and frozen are independent flags** and can coexist; a frozen
  media can be blocked.
- **Blocked media keeps its DEK** — a hold PRESERVES evidence: it stays
  readable on the panel (`/api/media`, M3) and is gone from the whole app
  plane, owner included.

### Reason catalog — `shared/moderation/moderation-reason.ts` (163)

`MODERATION_REASONS = spam | abuse | illegal_content | duplicate |
personal_data | other` (const tuple, `ModerationReason` type). Body of
every act is `moderationReasonDto`: `{ reasonCode, note? }` — `note`
trimmed, max 500, optional for a catalog code and **REQUIRED (>= 3
chars) when `reasonCode === 'other'`**; a blank note is dropped (never
stored as `""`). Failures surface as field codes via `params.code`
(decision 83): `reasonCode` REQUIRED / INVALID_OPTION, `note` REQUIRED /
TOO_SHORT / TOO_LONG. In `shared/` because reports and media both
consume it from day one.

### Columns (039)

- `tb_report`: `hidden CHAR(1) 'N'`, `hidden_reason_code VARCHAR(30)`,
  `hidden_note VARCHAR(500)`, `hidden_at DATETIME`, `hidden_by INT` (FK
  `tb_user`), `KEY idx_report_hidden (hidden)`. Own columns, not a
  `status` value: `status` is the case's lifecycle (open|resolved) and
  moderation is orthogonal to it (162).
- `tb_media`: `blocked_reason_code`, `blocked_note`, `blocked_at`,
  `blocked_by` (FK `tb_user`); `status` keeps its existing values —
  `blocked` already existed (028) and is now WRITTEN by the panel.

### Endpoints

All `requirePrivilege(REPORTS, UPDATE)`; body `{ reasonCode, note? }`;
422 with field codes on a bad body; 401 without token; 403 without the
grant (no audit row on any refusal).

| Route | Transition | Errors | Audit (`state_change`) | Returns |
|---|---|---|---|---|
| `POST /api/reports/:id/hide` | `hidden N -> S`, sets the five `hidden_*` (`hidden_by` = acting user) | 404 missing / deleted / purged; 409 `DUPLICATE` already hidden (also when the atomic UPDATE hits 0 rows) | `report` / id / `{ action: 'hide', reasonCode, note }` | the B1 `ReportPanelDetail`, refreshed |
| `POST /api/reports/:id/unhide` | `S -> N`, clears the five columns | 404 as above; 409 `DUPLICATE` not hidden | `report` / id / `{ action: 'unhide', reasonCode, note }` | `ReportPanelDetail` |
| `POST /api/media/:publicId/block` | `available -> blocked`, sets the four `blocked_*` | 404 missing or ANY other status (pending / blocked / deleted — existence is information, the M1 posture) | `media` / publicId / `{ action: 'block', reasonCode, note }` | `MediaModerationState` |
| `POST /api/media/:publicId/unblock` | `blocked -> available`, clears the four | 404 missing or not blocked | `media` / publicId / `{ action: 'unblock', reasonCode, note }` | `MediaModerationState` |

`note` is ALWAYS present in the audit summary (`null` when not given) so
the trail has one shape.

```
MediaModerationState {
  publicId, status: 'available'|'blocked',
  blockedReasonCode: ModerationReason|null, blockedNote: string|null, blockedAt: ISO|null
}
```

### Effects on existing surfaces

- **Feed** (`GET /app-feed`, `help-matching.repository.listNearby`):
  `AND r.hidden = 'N'` — a hidden case is gone from the feed.
- **App detail** (`reports.service.getReportView`): a third party gets
  **404** on a hidden case — open (public view) or resolved (closure
  summary) alike. Owner and participants keep the full view with
  `hidden: boolean` added to the `owner`/`participant` shapes of
  `ReportView` — the mark only, **never the reason** (167: the reason is
  the audit trail's, not the reporter's). Their `media` lists (and the
  public publicId list) come from the available-only query, so blocked
  media is excluded.
- **App media** (`getReportMediaVariant`): blocked media 404s for
  everyone on the app plane, the owner included; a hidden report's media
  404s for third parties and still streams for owner/participants.
- **Panel list**: `ReportListItem` gains `hidden: boolean`; search filter
  `hidden=true|false` (`INVALID_OPTION` on any other value).
- **Panel detail**: `ReportPanelDetail` gains `hidden, hiddenReasonCode,
  hiddenNote, hiddenAt, hiddenBy` (also on the purged skeleton — they are
  `tb_report` columns); each `media` item gains `blockedReasonCode,
  blockedNote, blockedAt` and blocked media stays listed with its status.
- **Untouched**: purge job, media-expiry job, freeze/unfreeze, edit,
  resolve (`reports-moderation.service.spec` asserts none of their
  repository writes run during a hide; the repository specs assert the
  SQL never names `expires_at` / `frozen` / `dek_wrapped`).

### Tests (B2)

`shared/moderation/__tests__/moderation-reason.spec` (catalog + every
field code), `reports-moderation.service.spec` (hide/unhide happy paths,
404/409, race, retention untouched, hidden+frozen coexist, list/detail
surfaces), `reports-moderation.routes.spec` (UPDATE vs VIEW grant, 422
codes, audit shape, 404/409 pass-through not audited, `hidden` filter),
`reports.repository.spec` + `help-matching.repository.spec` (SQL
contracts, feed exclusion), `reports.lifecycle.spec` + `reports.media.spec`
(app-plane visibility of hidden/blocked), `media-moderation.service.spec`,
`media-moderation.routes.spec`, `media.repository.spec`.

## B4 — statistics (decisions 164/165)

Aggregated counters for the panel, **never a row**: no id, no position,
no identity in any response (164/135/23) and **no geo aggregation at all
in this phase** (164 — the heat map reopens with real volume). Files
`reports-stats.{repository,service}.ts`, the `stats` controller action
and the `/stats` route in `reports-admin.*`, DTO `reportStatsQueryDto` in
`reports-admin.dto.ts`, the floor in `shared/stats/k-anonymity.ts`,
migration `040_report_stats.sql`.

### Interface (migration 040)

`report_stats` — kind 'T', group "Operations", **VIEW only** (165), its
own grant: the `reports` grant does NOT open it and vice versa. Bootstrap
to de-facto admins (UPDATE on Users), pattern of 038.
`InterfaceKeys.REPORT_STATS`.

### The k = 5 floor — `shared/stats/k-anonymity.ts` (164)

`floorCount(n): number | "<5"` — `0` stays `0` (an empty cell names
nobody), `1..4` is served as the string `"<5"`, `>= 5` stays the number.
It is the ONE place the floor exists; the service passes **every** count
through it — totals, each grouping row, the moderation groups — and does
so **after summing**: `byTier` is summed from the raw `byCategory` counts
and only then floored, so two categories served as `"<5"` can still add
up to a served tier (3 + 3 in `high` -> `byTier.high = 6`).

### `GET /api/reports/stats` — `report_stats` VIEW, NOT audited

Registered BEFORE `/:id` so the literal segment never parses as an id
(`reports-stats.routes.spec` proves the detail handler never runs).
Aggregates are not evidence, so no `tb_admin_audit` row is written
(unlike the detail, 166).

Query (422 with per-field codes on bad input, decision 83):

- `from`, `to` — the B1 `queryDate` rules: ISO date-time or
  `YYYY-MM-DD` (`INVALID_FORMAT` otherwise). `from` inclusive; a
  date-only `to` covers the whole day (bound = next midnight UTC, `<`);
  a date-time `to` is inclusive (`<=`). Defaults: `to` = now, `from` =
  `to` - 30 days. `from` after `to` -> 422 `INVALID_VALUE` on `from`
  (compared on the INPUT instants, so `from=2026-09-01&to=2026-09-01` is
  the whole day and `from=2026-09-02&to=2026-09-01` fails). Range longer
  than 366 days -> 422 `TOO_LONG` on `to` with `params.max = "366"`.
  These range checks live in the service (`resolveStatsRange`) because
  the `to` default is "now"; they surface as the same envelope.
- `granularity` — `day | week | month` (`INVALID_OPTION`), default `day`.

The range applies to `tb_report.created_at`; living rows only
(`deleted='N'`); **purged rows INCLUDED** — they are the statistical
skeleton the purge keeps on purpose (25/131).

Definitions (`reports-stats.repository.countTotals`):

| Total | Definition |
|---|---|
| `reports` | every living report created in range |
| `open` / `resolved` | by `status` |
| `anonymous` / `identified` | `anonymous = 'S'` / `'N'` |
| `frozen` | `frozen = 'S'` (141) |
| `hidden` | `hidden = 'S'` (162) |
| `expired` | `status='resolved' AND expires_at IS NOT NULL AND expires_at <= NOW()` — purged or not |
| `purged` | `purged = 'S'` |
| `withMedia` | at least one living `tb_media` attached through `tb_report_media`, any status (B1's `hasMedia`) |

Period key: `DATE_FORMAT(created_at, '%Y-%m-%d')` for `day`,
`DATE_FORMAT(created_at, '%Y-%m')` for `month`, and for `week` the
**ISO week** `YEARWEEK(created_at, 3)` rendered as `YYYY-Www`
(Monday-first, week 1 holds January 4th — the key that never splits a
week across two years and that the panel can compute locally). Periods
are ascending; empty periods are omitted.

Moderation groups: `hiddenByReason` = reports created in range that are
**currently** hidden, by `hidden_reason_code`; `blockedMediaByReason` =
living media with `status='blocked'` attached to reports created in
range, by `blocked_reason_code`. Notes and actors never leave.

```
200 {
  range: { from: ISO, to: ISO, granularity },      // the EFFECTIVE bounds (to = exclusive next midnight when date-only)
  totals: { reports, open, resolved, anonymous, identified, frozen, hidden, expired, purged, withMedia },   // each number | "<5"
  byPeriod:   [{ period: 'YYYY-MM-DD' | 'YYYY-Www' | 'YYYY-MM', reports }],
  byCategory: [{ category: string | null, tier, reports }],        // null = free-tag reports, tier = getRiskTier(null)
  bySubject:  [{ subject, reports }],
  byStatus:   [{ status, reports }],
  byTier:     [{ tier: 'low'|'medium'|'high', reports }],          // always the three tiers, summed BEFORE flooring
  moderation: {
    hiddenByReason:       [{ reasonCode, reports }],
    blockedMediaByReason: [{ reasonCode, media }]
  }
}
```

Example — `GET /api/reports/stats?from=2026-08-01&to=2026-08-31&granularity=week`:

```json
{
  "range": { "from": "2026-08-01T00:00:00.000Z", "to": "2026-09-01T00:00:00.000Z", "granularity": "week" },
  "totals": { "reports": 12, "open": 5, "resolved": 7, "anonymous": "<5", "identified": 8,
              "frozen": "<5", "hidden": 0, "expired": "<5", "purged": "<5", "withMedia": 6 },
  "byPeriod": [{ "period": "2026-W31", "reports": "<5" }, { "period": "2026-W32", "reports": 8 }],
  "byCategory": [{ "category": "missing", "tier": "high", "reports": "<5" },
                 { "category": "kidnapping", "tier": "high", "reports": "<5" },
                 { "category": "assault", "tier": "low", "reports": 6 }],
  "bySubject": [{ "subject": "adult", "reports": 8 }, { "subject": "child", "reports": "<5" }],
  "byStatus": [{ "status": "open", "reports": 5 }, { "status": "resolved", "reports": 7 }],
  "byTier": [{ "tier": "low", "reports": 6 }, { "tier": "medium", "reports": 0 }, { "tier": "high", "reports": 6 }],
  "moderation": { "hiddenByReason": [], "blockedMediaByReason": [{ "reasonCode": "personal_data", "media": "<5" }] }
}
```

### Tests (B4)

`shared/stats/__tests__/k-anonymity.spec` (0 / 1..4 / 5+ / invalid
input), `reports-stats.service.spec` (defaults, date-only vs date-time
bounds, same-day range, `from > to` and `> 366 days` 422 field codes,
exactly 366 accepted, floor on totals, byTier summed-then-floored,
free-tag tier, every grouping floored, no id/position/identity key in
the serialized response), `reports-stats.repository.spec` (period key
per granularity, `<` vs `<=`, parameters, totals definitions, GROUP BY
per grouping, moderation joins never select note/actor/publicId),
`reports-stats.routes.spec` (own grant vs `reports` grant, 422 codes,
service 422 pass-through, NOT audited, `/stats` not swallowed by `/:id`,
401).

## B3 — queue (decisions 161/165/166)

A **proactive** moderation queue: there is no user "flag content" signal
yet (161 — a future mobile front, behind the Legal Gate). The queue is
therefore every case that is `open`, NOT yet reviewed, NOT hidden (a
hidden case was already moderated), NOT purged, `deleted='N'`. **Frozen
cases stay in the queue.** "Reviewing" is ONE human holding `reports`
UPDATE (165 — no new interface; the grant declared in 038 already reads
"moderate / mark reviewed") stamping `reviewed_at` / `reviewed_by`. It is
audited (116) but needs **no reason** — it is not a moderation act, it
says "eyes were on it". Un-review does not exist in this phase. Files
`reports-queue.service.ts`, the `queue` / `reviewed` controller actions
and routes in `reports-admin.*`, `queueReports` / `markReviewed` in
`reports.repository.ts`, migration `041_report_review.sql`.

Invariants (each has a test):

- **Reviewing touches nothing else**: the `markReviewed` UPDATE moves
  ONLY `reviewed_at` / `reviewed_by` — never `hidden`, `frozen`,
  `status`, `expires_at`, no timeline event (`reports-queue.repository.spec`
  asserts the SQL; `reports-queue.service.spec` asserts no other
  repository write runs).
- **Hiding a queued case removes it from the queue**: the queue WHERE
  keys on the same `hidden` column the hide UPDATE flips.
- **Queue reads are list reads → NOT audited** (166). Opening a case from
  the queue goes through the B1 detail, which is.
- Everything the queue serves is the B1 `ReportListItem` (degraded
  position, no identity — 135/160): the mapping is ONE exported function
  (`toReportListItem` in `reports-admin.service`) shared by search and
  queue, so no list surface can degrade differently.

### Columns (041)

`tb_report`: `reviewed_at DATETIME NULL`, `reviewed_by INT NULL` (FK
`tb_user`), `KEY idx_report_review (status, reviewed_at)` — the queue's
WHERE. Own columns orthogonal to status / frozen / hidden / retention,
same posture as 039.

### Priority order (161)

Resolved in code, ranked in SQL. The service partitions every category
of the taxonomy into the tier it currently sits in (`shared/risk`
`getRiskTier`, as B1 does for its tier filter) and passes the three
sets plus `getRiskTier(null)` for free-tag rows; the repository orders by
a `CASE` over those sets:

```
ORDER BY CASE WHEN r.category IS NULL THEN <freeTagRank>
              WHEN r.category IN (<high...>)   THEN 0
              WHEN r.category IN (<medium...>) THEN 1
              WHEN r.category IN (<low...>)    THEN 2
              ELSE 2 END ASC,
         EXISTS(<living attached media, any status>) DESC,   -- B1's hasMedia
         r.created_at ASC, r.id ASC
```

An empty tier set drops its `WHEN` (never `IN ()`). When the future
"flag content" signal exists (161) it enters this SAME queue **above**
the tier priority — a comment at the ORDER BY marks the spot; it is not
built.

### `GET /api/reports/queue` — `reports` VIEW, NOT audited (166)

Registered BEFORE `/:id` (like `/stats`) so the literal segment never
parses as an id (`reports-queue.routes.spec` proves the detail handler
never runs). Query: `page` (>= 1, default 1), `pageSize` (1..100,
default 20); 422 with field codes on bad input (decision 83). The WHERE
and the ORDER BY are fixed by the decision, not by the caller.

```
200 { items: QueueItem[], page, pageSize, total }
QueueItem = ReportListItem & {
  priority: 'high'|'medium'|'low',   // the case's tier today (a flag signal would rank above it, 161)
  hasMedia: boolean,                 // mediaCount > 0
  ageHours: number                   // whole hours since created_at at serving time (clock skew -> 0, never negative)
}
```

### `POST /api/reports/:id/reviewed` — `reports` UPDATE, audited `state_change` / `report` / id / `{ action: 'reviewed' }`

No body (a stray body is ignored, never validated). 404 `NOT_FOUND` when
missing / soft-deleted / purged; **409 `DUPLICATE` when `reviewed_at` is
already set** (reviewing is idempotent-hostile — a second mark is a
signal that two operators collided), also when the atomic
`WHERE reviewed_at IS NULL` UPDATE hits 0 rows. Sets `reviewed_at =
NOW()`, `reviewed_by = req.user.userId`. Returns the B1
`ReportPanelDetail`, refreshed. No audit row on any refusal (401/403/
404/409). A hidden case can still be marked reviewed — the two marks are
independent.

### Surfaces that change

- `ReportListItem` gains `reviewed: boolean` (`reviewed_at IS NOT NULL`);
  search filter `reviewed=true|false` (`INVALID_OPTION` on any other
  value).
- `ReportPanelDetail` gains `reviewedAt: ISO|null`, `reviewedBy:
  number|null` (also on the purged skeleton — `tb_report` columns).
- `ReportRow` / `findById` project `reviewed_at` / `reviewed_by`;
  `ReportSearchRow` gains `reviewed`.
- **Untouched**: hide/unhide, freeze/unfreeze, stats, purge, the
  media-expiry job.

### Tests (B3)

`reports-queue.service.spec` (tier -> category sets incl. the free-tag
tier and pagination passed to the repository, the B1 shape plus
priority/hasMedia/ageHours, degraded position and no identity in the
serialized page, free-tag priority, `ageHours` whole hours / never
negative, frozen stays in, the service never re-filters/re-orders, mark
reviewed -> refreshed detail, no other write runs, 409 on a second mark
and on a lost race, 404 missing/purged, hidden case still reviewable),
`reports-queue.routes.spec` (VIEW vs UPDATE grant per route, defaults,
422 field codes, NOT audited on GET, audited on POST with the exact
summary, body ignored on POST, `/queue` not swallowed by `/:id`, 404/409
pass-through not audited, 400 on a bad id, 401, the `reviewed` search
filter), `reports-queue.repository.spec` (WHERE exclusions with frozen
kept in, the ORDER BY CASE / EXISTS / ASC contract and its parameters,
empty tier set, count-0 short-circuit, hide and queue agree on `hidden`,
`markReviewed` SQL touches only its two columns, 0 rows -> false,
`findById` / `searchReports` review projection and filter),
`reports-admin.service.spec` (reviewed filter pass-through, list mark,
detail `reviewedAt`/`reviewedBy` incl. the purged skeleton).

## B5 — audit trail screen (decisions 116/158/165/166)

The last phase of the front reads the `tb_admin_audit` rows the other
four write (166: "auditing without a way to read is half of 116"). It is
documented with the trail itself in
[admin-audit.md](./admin-audit.md) (section "Reading the trail — B5"):
module `src/modules/admin-audit/`, `GET /api/admin-audit` (list — who /
what / when, no ip), `GET /api/admin-audit/facets`, `GET /api/admin-audit/:id`
(the only response with the operator `ip`), all under the `admin_audit`
VIEW grant (migration 042), none audited, none writing. The date rule of
the B1 search moved to `shared/http/query-date.ts` so both modules share
it without importing each other.

### Status

- B1 — API side DONE 2026-09-02. 64 suites / 478 tests green; `tsc` clean.
- B2 — API side DONE 2026-09-02. 72 suites / 563 tests green; `tsc` clean.
- B4 — API side DONE 2026-09-02. 76 suites / 604 tests green; `tsc` clean.
- B3 — API side DONE 2026-09-02 (uncommitted). 79 suites / 643 tests green; `tsc` clean.
- B5 — API side DONE 2026-09-02 (uncommitted). 84 suites / 698 tests green; `tsc` clean.
