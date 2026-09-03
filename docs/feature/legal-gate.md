# Legal Gate

## OVERVIEW
Per-jurisdiction execution blocking (decisions 76-79, 103-109): each risk-bearing *capability* (`reward.monetary`, `report.anonymous`, …) has a declared status per country, enforced by the API. Fail-closed — no active rule in a real jurisdiction means blocked; only `SANDBOX` inverts the default and marks every response as demo. Rules are versioned, dual-controlled and always expire. Plan: `AI/docs/plans/plano-legal-gate.md`; decision log: `AI/docs/decisions/VGR-plano.md`.

## STRUCTURE
```
src/shared/legal/
├── capabilities.ts            # TS catalog (decision 103) — enforcement source of truth;
│                              #   PENDING_WIRING (guard 2) + CAPABILITY_REQUIRES (decision 98)
├── legal-gate.interface.ts    # GateDecision, GateReason, rule/jurisdiction rows
├── legal-gate.repository.ts   # findJurisdiction / findActiveRule / insertAudit (append-only)
├── legal-gate.ts              # checkCapability / assertCapability / invalidateLegalGateCache
└── __tests__/                 # gate behavior + catalog partition/sync specs

src/gateway/require-capability.middleware.ts   # HTTP edge: 451 + LEGAL_BLOCKED, X-VGR-Demo header

src/modules/legal-policy/      # administration (decision 106 — L1)
├── legal-policy.interface.ts / .dto.ts / .repository.ts / .service.ts / .controller.ts / .routes.ts
└── __tests__/

src/migrations/sql/022_legal_gate.sql   # tb_jurisdiction, tb_legal_capability,
                                        # tb_legal_rule, tb_legal_gate_audit + seeds
```

Mounted at `/api/legal-policy` (jurisdictions / capabilities / rules). The gate itself is consumed two ways: `requireCapability(cap)` on routes (stacks with `requirePrivilege` — privilege answers "may this user", capability answers "may this installation"), and `assertCapability(cap)` inside services for paths that never cross HTTP (offline queue — decision 28, scheduled jobs — decision 90).

## KEY BEHAVIORS
- **Jurisdiction resolution**: `LEGAL_JURISDICTION` env (decisions 68, 105). Unset → `SANDBOX` outside production, `UNCONFIGURED` (blocks everything) in production.
- **Kill switch** (decision 107): `tb_jurisdiction.operational_state`, read with TTL **zero**, outside the degraded path — unreadable ⇒ treated as `suspended`. Tightening (→`suspended`) applies with ONE update-holder; loosening (→`live`) waits as `pending_state` for a DIFFERENT confirmer holding the `dual_control_approval` resource. Generalization recorded in decision 107: "shut down fast, turn back on slowly" — rank live<restricted<suspended, target ≥ current applies immediately.
- **Rules** (decisions 107-108): born `proposed`, enforced only when a distinct user approves (`active`, previous version `superseded` in the same transaction). Every rule expires — `expires_at` set from proposal time + `expiresInDays` (default 180). Expired reads as `unreviewed` ⇒ blocked, judged at read time (no scheduler needed for enforcement).
- **Dependency** (decision 98): `reward.monetary` requires `reward.mediation` allowed in the same jurisdiction — enforced at promotion (both directions) AND at evaluation (`reason: 'dependency'`).
- **Degradation** (decision 109): rule cache TTL 60s; on lookup failure, last known state served up to `LEGAL_GATE_DEGRADED_WINDOW_MS` (default 15 min), each use audited as `degraded`; window exhausted or key never cached ⇒ blocked `unavailable`.
- **Audit** (plan L6): append-only `tb_legal_gate_audit`. **Amendment**: plain allows under an active rule are NOT audited — volume would drown the log and the rule row already proves the basis; audited outcomes are `blocked`, `demo` (sandbox allow) and `degraded`. Writes are fire-and-forget with logged failure.
- **Error contract** (decision 80): blocks ship HTTP **451** with code `LEGAL_BLOCKED` and `params: {capability, reason}` — the client translates by code.

## STATUS
- L0+L1 (decision 106) — DONE 2026-08-03. 26 suites / 151 tests green; `tsc` clean.
- **Every capability is in `PENDING_WIRING`**: the consuming domain features (report, reward, panic dispatch) are not built yet. `capabilities.catalog.spec.ts` fails the build if an entry is ever neither wired nor pending, or both — when a domain task wires a capability, it must remove the entry.
- L3 (admin screens) — DONE 2026-08-19 in `apps/admin` (`app/docs/feature/legal-policy.md`). L2 (AI assessment pipeline → `tb_legal_assessment`, promotion from assessment) is NOT built — blocked on choosing the AI provider. Round-2 items 6 (frozen-data behavior) and 7 (assessment record shape) remain open, non-blocking.
- `chat.masked` (decision 176) added 2026-09-03 by the masked-chat front, born WIRED (`modules/messaging/chat.service.ts` asserts it before thread creation and before every post) — see `docs/feature/chat.md`.
- Expiry warning job: deliberately not built (decision 90 note — no scheduler until a real job needs it; enforcement doesn't need one).

## REFERENCES
- [**README.md**](../README.md): documentation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern; why the gate lives in `@shared/legal`.
- [**access-control.md**](./access-control.md): `requirePrivilege` — the sibling guard this one stacks with.
- [**dual-control-access.md**](./dual-control-access.md): the approver resource (`dual_control_approval`) reused by rule approval and state confirmation.
