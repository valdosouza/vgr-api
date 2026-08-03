# Admin Audit

## OVERVIEW
Append-only trail of **who did what** on the admin panel (decision 116, layer SEC-6 of the security plan). Before it, a privilege granted to the wrong person left no record of who granted it — the specialized trails (`tb_legal_gate_audit`, dual-control requests) covered their own areas and nothing covered ordinary CRUD.

## STRUCTURE
```
src/shared/audit/admin-audit.ts        # auditAdminAction / auditFromRequest
src/migrations/sql/025_admin_audit.sql # tb_admin_audit (append-only)
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

## STATUS
- Phase S4 of the security plan — DONE. Covered by `shared/audit/__tests__/admin-audit.spec.ts` (fields recorded, redaction, failure tolerance, no-op without an authenticated user).
- **No read/list endpoint yet**: rows go in, nothing serves them. A panel screen for the trail is future work — the data is being collected from day one so that screen has history to show when it exists.

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**access-control.md**](./access-control.md): the privilege model whose grants this records.
- [**legal-gate.md**](./legal-gate.md): the sibling append-only trail, and the pattern this one generalizes.
