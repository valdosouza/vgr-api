# Dual Control Access

## OVERVIEW
`DualControlAccessRequest` workflow (decision 45): access to decrypt an `AccountabilityLogEntry` needs a logged legal basis and **two distinct people** — the one who opens the request (its first authorization) and ONE approver who is a different user (decision 224, the house rule of 107/141d). Both come from the panel session (`req.user`), never from the request body (223).

The log is encrypted at rest since migration 024 (decisions 44/111). Revealing an entry is **not** built: decision 228 keeps it for its own round, after the legal review decision 45 asks for (every attempt logged, single use, expiry). Nothing consumes `granted` today — this module keeps the gate whole so the reveal fits it when it comes.

Round 18 (decisions 223–229, `AI/docs/plans/plano-dual-control.md`) rebuilt the gate: until then the approver was a free-text id in the body, so one admin holding both grants could approve twice and reach "2 distinct approvers" alone.

## STRUCTURE
```
src/modules/admin-access/
├── dual-control.interface.ts   # DualControlStatus (pending | granted | void), DualControlAccessRequestRow
├── dual-control.dto.ts         # Zod: create { accountabilityLogEntryId, legalBasis 1..500 trimmed }; list = pagedQueryDto
├── dual-control.repository.ts  # SQL: accountabilityEntryExists, createRequest, listRequests/countRequests, findRequestById, grantRequest
├── dual-control.service.ts     # createDualControlRequest, listDualControlRequests, approveDualControlRequest
├── dual-control.controller.ts  # actor = req.user; audit after success
├── dual-control.routes.ts      # POST /, GET /, POST /:id/approvals
└── __tests__/                  # service, repository (SQL contracts), controller (routes)
src/migrations/sql/016_dual_control_access.sql   # the table
src/migrations/sql/050_dual_control_session.sql  # round 18: requester/approver columns, void, CHECKs
```

Mounted at `/api/dual-control-access` (panel plane, `authMiddleware`). Guards (decisions 72/93): `POST /` is INSERT and `GET /` is VIEW on `dual_control_access`; `POST /:id/approvals` stacks `dual_control_access.UPDATE` AND the approver resource `dual_control_approval.UPDATE`.

## CONTRACT
| Route | Body / query | Answer |
|---|---|---|
| `POST /` | `{ accountabilityLogEntryId, legalBasis }` | 201 `data: row` (status `pending`, `requestedBy` = session user) · 404 `NOT_FOUND` when the log entry does not exist · 422 `VALIDATION_FAILED` |
| `GET /` | optional `page`, `pageSize` (1..100, default 20), `filter` (LIKE on the legal basis) | without `page`: `data: row[]`; with `page`: `data: { items, page, pageSize, total }` (decision 220). Newest first. |
| `POST /:id/approvals` | none — any body is ignored | 200 `data: row` (status `granted`) · 404 `NOT_FOUND` · 422 `BUSINESS_RULE` when the approver is the requester · 409 `BUSINESS_RULE` when the request is not pending (granted, void, or lost a simultaneous approval) |

`row` = `{ id, accountabilityLogEntryId, legalBasis, status, requestedBy, requestedByName, approvedBy, approvedByName, approvedAt, createdAt }`. Names are the panel team's display names (`tb_user.name`), never e-mail (227).

## KEY BEHAVIORS
- **One person never grants alone** — enforced twice: the service refuses the requester as approver (422), and `chk_dual_control_two_people` (migration 050) refuses any `granted` row whose `approved_by` is missing or equals `requested_by`, so even a service bug cannot store a one-person grant. `chk_dual_control_requester` keeps every live request tied to who opened it.
- **No lost approvals**: approving is a conditional write (`… WHERE id = ? AND status = 'pending'`); of two simultaneous approvals one wins, the other gets 409 (verified against MySQL 8.0 with two concurrent calls).
- **Audited** (decision 116 via 226): opening and approving each write `tb_admin_audit` — action `state_change`, entity `dual_control_access`, summary `{ action: 'request', accountabilityLogEntryId, legalBasis }` / `{ action: 'approve' }`. A refused attempt writes nothing; the audit follows a successful change, as everywhere in the panel.
- **The log is not read**: `accountabilityEntryExists` asks only whether the id exists (`SELECT 1`), never for its content.
- **Pre-round-18 requests are `void`** (decision 225): migration 050 voided every existing row and kept the typed approvers in `legacy_approver_ids` as history only. A void row has no requester, is never approvable, and the API does not expose the legacy column.

## STATUS
- Task 31 (`DualControlAccessRequest` workflow) — DONE; rebuilt by round 18 / DC1 (2026-10-04).
- Panel: the screen still speaks the old contract (one request in the bloc, an approver text field) until DC2 — list + propose form + approve on the row (227) — is released. Until then the old screen cannot read the new rows (`approverIds` is gone).
- Reveal (decrypting a granted entry): out of scope, decision 228.

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows.
- [**identity.md**](./identity.md): `AccountabilityLogEntry`, the entity this workflow gates access to.
- [**access-control.md**](./access-control.md): the `dual_control_approval` resource.
- [**admin-audit.md**](./admin-audit.md): the trail the gate writes to.
