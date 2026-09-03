# Admin Audit

## OVERVIEW
Append-only trail of **who did what** on the admin panel (decision 116, layer SEC-6 of the security plan). Before it, a privilege granted to the wrong person left no record of who granted it — the specialized trails (`tb_legal_gate_audit`, dual-control requests) covered their own areas and nothing covered ordinary CRUD.

## STRUCTURE
```
src/shared/audit/admin-audit.ts               # auditAdminAction / auditFromRequest (the ONLY writer)
src/shared/audit/audit-action.ts              # AUDIT_ACTIONS tuple + AuditAction type
src/migrations/sql/025_admin_audit.sql        # tb_admin_audit (append-only)
src/migrations/sql/042_admin_audit_screen.sql # admin_audit interface + list indexes (B5)
src/modules/admin-audit/                      # READ side: /api/admin-audit (B5)
```

Called from **controllers**, after a successful mutation. That is deliberate (implementation note on decision 116): the actor and the IP live at the HTTP layer, and threading them through every service signature would push transport context into the domain for no gain.

## KEY BEHAVIORS
- **Append-only**: the code only ever INSERTs. No update, no delete, no soft-delete column — a trail that can be edited is not a trail.
- **Fire-and-forget**: a failed audit write never takes the audited action down with it, but it is never silent either (logged). Same pattern as the Legal Gate audit.
- **Secrets are redacted before storage** (decision 110): any field whose name looks like `password`/`secret`/`token`/`key` is replaced with `[redacted]`, recursively. The audit table is a log, and no secret ever reaches a log.
- **Real client IP**: relies on `trust proxy` (decision 115) — without it every row would record the proxy.

## WHAT IS AUDITED
| Entity | Actions | Where |
|---|---|---|
| `user` | create · update · delete | users controller |
| `user_privileges` | grant | users controller — *the case that motivated the decision* |
| `user_2fa_reset` | update | dual-control 2FA reset (decision 114) |
| `privilege`, `interface`, `system_module` | create · update · delete | respective controllers |
| `risk_tier`, `category_form`, `fee_rule` | update | respective controllers |
| `jurisdiction` | state_change | Legal Gate kill switch (decision 107) |
| evidence media | read | panel views of a reporter's image (decision 130) |

`read` exists only for evidence media: auditing every read of everything would drown the log, but looking at a reporter's photo is exactly the act that must leave a row.

## READING THE TRAIL — B5 (decisions 158/165/166)

Module `src/modules/admin-audit/` (interface, dto, repository, service,
controller, routes), mounted at `/api/admin-audit` (panel plane, behind
`authMiddleware`). Migration `042_admin_audit_screen.sql`: interface
`admin_audit` — kind 'T', group "Administration", **VIEW only** (165),
bootstrap to de-facto admins (UPDATE on Users, pattern of 038/040);
`InterfaceKeys.ADMIN_AUDIT`; indexes `idx_admin_audit_created
(created_at)` and `idx_admin_audit_action (action, created_at)`.

Rules (each has a test):

- **Still append-only** (116): this phase adds READ only. The repository
  issues SELECTs and exposes three read functions; POST/PUT/PATCH/DELETE
  on `/api/admin-audit*` do not exist (404).
- **Reading the trail is NOT audited** (166 — auditing the audit would be
  recursive and would drown the trail). The controller never imports
  `auditFromRequest`; the routes spec asserts it is never called.
- **`summary` is served as stored**: parsed with `JSON.parse` when it is
  JSON (it always is when written by `auditAdminAction`, already
  secret-redacted, 110), the raw string otherwise, `null` when null.
  Never re-interpreted; the panel renders it as text / JSON tree only.
- **`ip` is personal data**: projected and served ONLY by the single-entry
  read; the list SQL never selects the column and the list item has no
  `ip` key.
- **No cross-plane leak**: `actorName` is `tb_user.name` via a LEFT JOIN
  with no `deleted`/`active` filter — a soft-deleted operator still names
  its rows (the trail must not lose its actor); never an app account.
- Date filters share `shared/http/query-date.ts` with the B1–B4 lists
  (promoted from `reports-admin.dto` in this phase): `from` inclusive; a
  date-only `to` covers the whole day (next midnight UTC, `<`); a
  date-time `to` is inclusive.

### `GET /api/admin-audit` — `admin_audit` VIEW

Query (422 with per-field codes on bad input, decision 83): `page` (>= 1,
default 1), `pageSize` (1..100, default 50), `actorId` (int >= 1),
`action` (`create|update|delete|grant|state_change|read` —
`INVALID_OPTION` otherwise), `entity` (1..40), `entityId` (1..40),
`from` / `to` (`INVALID_FORMAT`). Sort `created_at DESC, id DESC`.

```
200 { items: AuditListItem[], page, pageSize, total }
AuditListItem {
  id, actorId, actorName: string|null, action, entity, entityId: string|null,
  summary: unknown|null,      // parsed JSON when parseable, else the raw string
  createdAt: ISO
}
```

### `GET /api/admin-audit/facets` — `admin_audit` VIEW

Registered BEFORE `/:id`. `200 { actions: string[], entities: string[] }`
— DISTINCT values present in the table, sorted (the screen's dropdowns).

### `GET /api/admin-audit/:id` — `admin_audit` VIEW

`200 AuditEntry = AuditListItem & { ip: string|null }`; 404 `NOT_FOUND`
when missing; 400 `INVALID_ID` on a non-numeric id.

### Tests (B5)

`admin-audit.repository.spec` (count-then-select, LEFT JOIN without a
deleted filter, every filter clause and its parameters, `<` vs `<=`,
count-0 short-circuit, `ip` absent from the list projection and present
in the entry, facets DISTINCT/ORDER BY, every statement is a SELECT, only
read functions exported), `admin-audit.service.spec` (filter pass-through,
date bounds, summary parsed / raw / null / redacted marker kept, null
actor name, no `ip` in list items even from a leaky row, entry with ip,
404, facets, only read operations exported), `admin-audit.routes.spec`
(grant per route — `reports`/`users`/`report_stats` do not open it, 401,
defaults, every filter coerced, no ip in the list body, 422 field codes,
every action accepted, `/facets` not swallowed by `/:id`, NOT audited on
any read, 404/400 pass-through, POST/PUT/PATCH/DELETE 404),
`shared/http/__tests__/query-date.spec`, `shared/audit/__tests__/audit-action.spec`.

## STATUS
- Phase S4 of the security plan — DONE. Covered by `shared/audit/__tests__/admin-audit.spec.ts` (fields recorded, redaction, failure tolerance, no-op without an authenticated user).
- **B5 — read endpoints DONE 2026-09-02** (uncommitted): `GET /api/admin-audit`, `/facets`, `/:id` under the `admin_audit` VIEW grant (migration 042); reads not audited (166); `ip` only in the detail; 84 suites / 698 tests green; `tsc` clean. The panel screen is the app side of B5 (`app/docs/feature/admin-audit.md`).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**access-control.md**](./access-control.md): the privilege model whose grants this records.
- [**legal-gate.md**](./legal-gate.md): the sibling append-only trail, and the pattern this one generalizes.
