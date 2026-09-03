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

### Status

- B1 — API side DONE 2026-09-02. 64 suites / 478 tests green; `tsc` clean.
- B2 (hide report / block media), B4 (stats), B3 (queue), B5 (audit
  trail screen) — pending, each behind its own "pode seguir" (38).
