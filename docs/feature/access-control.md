# Access Control (privileges, interfaces, modules, users, dynamic menu)

## kind 'R' resources (decision 93)

`tb_interface.kind = 'R'` catalogs a permissionable SUB-RESOURCE (tab,
special action) that never reaches the menu (`GET /api/core/menus` keeps
filtering `kind = 'T'`); grants are managed on the same Users matrix.
Resources so far:
- `user_privileges` (migration 020) — splits *editing user data* (`users`)
  from *granting access*: the grant routes stack both guards (AND
  semantics: `users.*` at router level + `user_privileges.*` per route),
  and the self-lockout rule also covers revoking your own granting power.
- `dual_control_approval` (migration 021, decisions 45/93) — the approver
  role of the dual-control gate, separate from operating the screen:
  `POST /:id/approvals` stacks `dual_control_access.UPDATE` AND
  `dual_control_approval.UPDATE`, so requesters and approvers can be
  different people. Cataloged with UPDATE only (seeing requests remains
  the screen's VIEW). Bootstrap: screen-UPDATE holders kept approving.
`GET /api/core/permissions` returns the session user's full grant map
(T + R) — the app's `SessionAccess` consumes it, falling back to the menu
tree (default-deny for 'R') when the call fails.

## OVERVIEW
Per-user permission model (decisions 68-75 in `AI\docs\decisions\VGR-plano.md`),
mirroring the setes design minus its institution layer: **user × interface
(screen) × privilege**, with the menu assembled by the backend. Key traits:

- Single-schema, one installation per country (decision 68) — no tenancy.
- Everything ships in the package; visibility/action is decided only by user
  grants (decision 69) — there is no per-interface licensing.
- No super user (decision 70): the Admin is a `tb_user` holding grants on the
  administration screens; bootstrap via `scripts/seed-admin.ts`.
- **The API enforces privileges on every endpoint** (decision 72) — conscious
  divergence from setes-api, where grants only filter the menu.

## DATA MODEL (migration 019)
```
tb_user                      team user (evolution of tb_admin_account — decision 74)
tb_privilege                 VIEW / INSERT / UPDATE / DELETE / PRINT (by NAME, no magic ids)
tb_interface                 screen catalog: i18n_key (stable key), group_default, kind 'T'/'R', position
tb_interface_has_privilege   which privileges each screen exposes
tb_module                    Admin-managed menu grouping (CRUD is new — setes never had it)
tb_module_has_interface      ordered screens inside a module
tb_user_has_privilege        the effective grant (PK user × interface × privilege)
```

## ENFORCEMENT
- `src/gateway/require-privilege.middleware.ts` — `requirePrivilege(interfaceKey,
  privilege?)`; privilege defaults by method (GET→VIEW, POST→INSERT,
  PUT/PATCH→UPDATE, DELETE→DELETE). Replaced `require-admin.middleware.ts`.
- `src/shared/acl/privilege-store.ts` — per-user grant lookup, 60s TTL cache,
  invalidated by the users/interfaces/privileges services on mutation.
- `src/shared/acl/privileges.ts` — `Privileges` + `InterfaceKeys` constants;
  keys must match the `tb_interface.i18n_key` seeds.
- JWT payload unchanged (`{ userId, role: 'admin' }`): `role` only marks a team
  user for the mobile-role type union; it grants nothing by itself.

## ENDPOINTS
| Route | Guard (interface key) | Notes |
|---|---|---|
| `GET/POST/PUT/DELETE /api/privileges[/:id]` | `privileges` | catalog CRUD |
| `GET/POST/PUT/DELETE /api/interfaces[/:id]` | `interfaces` | screen CRUD + `privilegeIds[]` sync |
| `GET/POST/PUT/DELETE /api/system-modules[/:id]` | `system_modules` | menu module CRUD + ordered `interfaceIds[]` |
| `GET/POST/PUT/DELETE /api/users[/:id]` | `users` | team CRUD (decision 75 — Admin creates directly) |
| `GET /api/users/:id/privileges` | `users` | full matrix screen × privilege × granted |
| `PUT /api/users/:id/privileges/:interfaceId` | `users` (UPDATE) | grants list, revokes the rest; granting anything implies VIEW |
| `GET /api/core/menus` | none (session-own) | tree filtered by the caller's VIEW grants |
| `GET /api/core/me` · `PUT /api/core/preferences` | none (session-own) | profile + locale persistence |

The 5 pre-existing admin modules (risk-config, category-forms,
panic/responder-pool, dual-control-access, monetization-config) now use
`requirePrivilege` with their own interface keys.

## BUSINESS RULES
- Granting any privilege on a screen implies VIEW (setes rule, kept by name).
- Grant requests are validated against the screen's cataloged privileges (422).
- Lockout guards: an Admin cannot delete their own account nor revoke their own
  access to the Users screen (no super user exists to recover access).
- Privileges in use (cataloged or granted) and interfaces with grants cannot be
  deleted (409); modules can — their screens fall back to `group_default`.
- Deactivated (`active='N'`) accounts get the same generic 401 on login.

## STATUS
- Phase 1 of the admin-controls plan
  (`AI\docs\plans\plano-controles-administrativos.md`) — DONE (this document).
- Client side (dynamic menu, auth package, i18n) is phases 2-5, not started.
- Pending (round 1): API errors stay English with stable codes (app
  translates); `kind 'R'` cataloged but unused.

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**auth.md**](./auth.md): login flow that issues the JWT this model gates.
- [**identity.md**](./identity.md): mobile roles — outside the privilege system.
