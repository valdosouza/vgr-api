# Panic Responders

## OVERVIEW
`ResponderPoolMembership` request/approval workflow (decisions 51-52): any authenticated user can request Authorized Responder status; only an admin can approve or deny it. Approved members are the pool `PanicAlert` routes to by default (task 28) when no personal contact is configured (decision 65).

## STRUCTURE
```
src/modules/panic/
├── responder-pool.interface.ts   # MembershipStatus, ResponderPoolMembershipRow
├── responder-pool.dto.ts         # Zod: { approved: boolean }
├── responder-pool.repository.ts  # SQL: createMembershipRequest, findPendingMemberships, resolveMembership, findActiveMembers
├── responder-pool.service.ts     # requestResponderAuthorization, listPendingResponderRequests, resolveResponderRequest, findActiveResponders
├── responder-pool.controller.ts  # POST (any authenticated Role) + GET/PUT resolve (admin-gated)
├── responder-pool.routes.ts      # POST /, GET /, PUT /:id/resolve
└── __tests__/
```

Mounted at `/api/panic/responder-pool` via `src/gateway/router.ts`. `GET`/`PUT :id/resolve` are `requireAdmin`-gated; `POST` is open to any authenticated caller (criteria for who may apply is still undefined, decision 52).

## STATUS
- Task 27 (ResponderPoolMembership request/approval workflow) — DONE.
- Amendments made while implementing (see `004-api-test-scenarios.md` for the added checklist items):
  - `RequestResponderAuthorization`/`ApproveResponderAuthorization` were listed in the tactical design's Use Case Catalog but had no GWT test-scenario coverage — added rather than inventing untracked test cases.
  - `src/shared/types/express.d.ts`'s `AuthenticatedUser.role` carried a leftover pre-decision-17 Portuguese union (`'denunciante' | 'policial'`) unreferenced anywhere else in `src/` — corrected to the English values consistent with `@modules/identity/identity.interface.ts`'s `Role`.
  - Added `criteriaNotes` (nullable free text, optional on `POST`) — missing from the initial implementation but required by admin task 05's acceptance criterion ("Criteria field remains free-text pending decision 52's resolution") and by `003-admin-tactical-design.md`'s `ResponderApprovalEntity` row ("userId + status + criteria notes"). Not validated — decision 52 hasn't defined eligibility rules yet.
- No `revoked` status exists separately from `denied` — calling `resolve` again on an already-approved membership flips it to `denied`, which satisfies "excluded from `findActiveMembers`" without a fourth status (matches the admin-side `ResponderApprovalEntity`'s 3-value `status`).
- Consumed by: admin task 05 (`apps/admin` panic-responders queue page), and later by API task 28 (`PanicAlert` routing via `findActiveResponders`).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows.
