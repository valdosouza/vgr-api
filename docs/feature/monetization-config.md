# Monetization Config

## OVERVIEW
Admin-managed registry mapping each Category (or the global default, `category=null`) to a `feePercent` and `paymentModeAllowed` set (decisions 39, 58) — the fee taken on intermediated Reward payouts, and which payment modes a Category permits. TTL-cached like `risk-config`. A Category with no rule of its own falls back to the global default; with neither configured, falls back to a built-in default (no fee, both modes allowed).

## STRUCTURE
```
src/modules/monetization-config/
├── fee-rule.interface.ts   # PaymentMode, FeeRuleRow (category: string | null)
├── fee-rule.dto.ts         # Zod: { feePercent: 0-100, paymentModeAllowed: ('intermediated'|'peer_to_peer')[] }
├── fee-rule.repository.ts  # SQL: findByCategory, findAll, upsert — 'global' sentinel maps to category=null
├── fee-rule.service.ts     # getFeeRule (TTL cache + fallback chain), setFeeRule, listFeeRules
├── fee-rule.controller.ts  # GET (list), GET :category (effective rule), PUT :category — all requireAdmin-gated
├── fee-rule.routes.ts
└── __tests__/
```

Mounted at `/api/monetization-config` via `src/gateway/router.ts`. `PUT /global` sets the global default (DB stores it under the literal category value `'global'`, translated to `null` in the domain layer — no real curated Category is named that, so there's no collision).

## STATUS
- Task 32 — DONE, but **this task didn't exist in the original backlog**. `003-admin-tactical-design.md`'s task 07 (`FeeRuleEntity`/`FeeRuleRepository`) and decisions 39/58 both require an API-side counterpart, but `003-api-tactical-design.md` never had one — added as task 32 with an amendment note, plus the missing `004-api-test-scenarios.md` coverage, before implementing (same "amend before diverging" pattern as tasks 27/31's gaps).
- Default when nothing is configured: `feePercent: 0`, `paymentModeAllowed: ['intermediated', 'peer_to_peer']` — least restrictive absent explicit admin configuration, mirroring `risk-config`'s `'low'`-tier default philosophy (see `risk-config.md`).
- **Known, deliberately unfixed gap**: the tactical design's admin task 07 acceptance criterion "High-tier Categories cannot have `peer_to_peer` added to `paymentModeAllowed`" (mirrors decision 58) is **not enforced here**. Enforcing it would require this module to read `RiskTierConfig`, which lives in the `risk-config` module — reachable only by violating `ARCHITECTURE.md`'s no-cross-module-import rule, since the RiskTier lookup has never been promoted to `shared/` (no consumer has forced that yet; task 24, which would also need it, isn't built either). Fixing this properly means extracting a `shared/risk/risk-tier.service.ts` read-only lookup — not done here to avoid an unplanned refactor of already-shipped, tested code. The independent hard veto in `PaymentIntent` (task 30, not yet built) is unaffected by this gap once it exists — that check doesn't go through `FeeRule` at all.
- Consumed by: admin task 07 (`FeeRuleEntity`, repository, monetization config page).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows, and the no-cross-module-import rule this task's known gap runs into.
- [**risk-config.md**](./risk-config.md): sibling admin-config feature, same TTL-cache/default-value pattern.
