# Dual Control Access

## OVERVIEW
`DualControlAccessRequest` workflow (decision 45): grants access to decrypt an `AccountabilityLogEntry` only after a logged legal basis and 2 **distinct** admin approvals. `accountabilityLogEntryId` is stored as a plain reference — actual decryption/reveal of the entry's content is out of scope until encryption itself is decided (nothing in this codebase implements encryption yet); this module only builds the legal-basis + 2-approver gate.

## STRUCTURE
```
src/modules/admin-access/
├── dual-control.interface.ts   # DualControlStatus, DualControlAccessRequestRow
├── dual-control.dto.ts         # Zod: create { accountabilityLogEntryId, legalBasis }, approval { approverId }
├── dual-control.repository.ts  # SQL: createRequest, findAllRequests, findRequestById, persistApproval
├── dual-control.service.ts     # createDualControlRequest, listDualControlRequests, addApproval
├── dual-control.controller.ts  # POST (create), GET (list), POST /:id/approvals — all admin-gated
├── dual-control.routes.ts      # POST /, GET /, POST /:id/approvals
└── __tests__/
```

Mounted at `/api/dual-control-access` via `src/gateway/router.ts`, all three routes `requireAdmin`-gated (unlike `panic/responder-pool`'s open `POST /` — this entire capability is admin-only per decision 45).

## STATUS
- Task 31 (`DualControlAccessRequest` workflow) — DONE.
- `approverId` is a client-supplied string in the `POST /:id/approvals` body, not derived from the caller's JWT — deliberately, because none of `apps/admin`'s existing repositories send a Bearer token yet (`ApiClient.get`/`put` calls across `risk-config`/`category-forms`/`panic-responders` never pass one either — admin login/token-acquisition simply hasn't been built). Deriving the approver from `req.user.userId` would be the more secure design once that exists; flagged here, not fixed, to avoid scope creep into building admin auth in this task.
- Duplicate-approval rejection (409, `DUPLICATE`) happens at the service layer by checking `approverIds.includes(approverId)` — case-sensitive, no normalization, since decision 45 doesn't specify an approver-identity format yet.
- Depended on task 12 (`AccountabilityLogEntry`) per the tactical design's `depends_on`, but doesn't call into it directly — `accountabilityLogEntryId` is an opaque number, not validated against a real row (that repository has no read method by design; see `identity.md`).
- Consumed by: admin task 06 (`DualControlRequestPage`, two-approval progress UI).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows.
- [**identity.md**](./identity.md): `AccountabilityLogEntry`, the entity this workflow gates access to.
