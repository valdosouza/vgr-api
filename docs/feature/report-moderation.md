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
  offers: [{ helpOfferId, helpType, anonymous, helper: {accountId, displayName}|null, createdAt }]
}
```

Identified actors are NOT tier-degraded here (decision 60 — the panel is
the platform; 41 protects against the reporter's correlation). The
media list carries publicIds only: the image itself is still served by
`/api/media/:publicId/:variant` under `media_evidence` (130).

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

### Status

- B1 — API side DONE 2026-09-02. 64 suites / 478 tests green; `tsc` clean.
- B2 — API side DONE 2026-09-02. 72 suites / 563 tests green; `tsc` clean.
- B4 (stats), B3 (queue), B5 (audit trail screen) — pending, each behind
  its own "pode seguir" (38).
