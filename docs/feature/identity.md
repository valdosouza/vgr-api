# Identity

## OVERVIEW
Domain-only module implementing the layered identity/anonymity model (decision 4): `Role` (a user's capacity within a Report) and `AnonymityMode` (how identity is exposed to other users, decision 6). Mirrors `packages/core`'s `Role`/`AnonymityMode` on the Flutter side, using this project's snake_case convention for multi-word enum values (matches `LoginProvider`/`PaymentMode`).

## STRUCTURE
```
src/modules/identity/
├── identity.interface.ts             # Role, AnonymityMode, UserIdentity
├── identity.service.ts                # createRole, createAnonymityMode, transitionRole
├── accountability-log.interface.ts    # AccountabilityLogEntryRow
├── accountability-log.repository.ts   # appendAccountabilityLogEntry — no read/list export, by design
└── __tests__/
```

No repository/routes/migration for `identity.*` in task 11's scope — pure domain rules, consumed by other modules as they're built (`UserAccount`/registration, `Report`/anonymity enforcement, `panic`/responder pool).

## STATUS
- Task 11 (Role, AnonymityMode, UserIdentity) — DONE.
  - `createRole`: validates against the 5-value set (`anonymous`, `reporter`, `helper`, `police`, `admin`); throws 422 on an unknown value.
  - `createAnonymityMode`: validates against the 3-value set; rejects `identified_with_reward` without a completed `UserAccount` registration (decision 4).
  - `transitionRole`: rejects any transition to `police` outright (403, deferred per decision 12); rejects a transition from `anonymous` to anything other than `reporter`/`helper`.
- Consumed by: API task 27 (`ResponderPoolMembership` workflow, needs `Role`/`UserIdentity` to gate who can request Authorized Responder status).
- Task 12 (`AccountabilityLogEntry` append-only log) — DONE, but narrower than its own acceptance criterion. `appendAccountabilityLogEntry` is built and unit-tested (writes `actionType`/`ipAddress`/`metadata`), and the "never queryable through any repository method used by a public-facing controller" guarantee is enforced structurally (no `.controller.ts`/`.dto.ts`/`.routes.ts` file exists for this module, verified by a test that asserts so). What's **not** done: "Entry is written on every anonymous Report/HelpOffer submission" can't be wired up or verified yet — `SubmitReport`/`SubmitHelpOffer` (tasks 03/06) don't exist. Revisit this module then to actually call `appendAccountabilityLogEntry` from those use cases.
- Consumed by: API task 31 (`DualControlAccessRequest` workflow needed a task-12 dependency per the tactical design, satisfied by this module existing — it does not call into it directly; see `dual-control-access.md`).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows.
