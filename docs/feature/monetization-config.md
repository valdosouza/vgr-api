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
- **Gap CLOSED (2026-08-19, decisions 58/82)**: the risk-tier veto is now enforced here. The extraction the original gap note waited on happened in Reports R2 (`shared/risk/risk-tier`, promoted when the feed became a consumer), so this module reads it with no cross-module import:
  - **Read-time (the invariant)**: `getFeeRule`'s effective rule for a high-tier category NEVER contains `peer_to_peer` — whether it came from the category's own rule, the global fallback, the built-in default, or a tier raised after the rule was written. The veto is applied outside the fee cache, so a tier change converges on the tier cache's own TTL.
  - **Write-time (the admin's error)**: `setFeeRule` refuses (422 `BUSINESS_RULE`) an explicit `peer_to_peer` on a high-tier category, so the panel shows a refusal rather than silently stripping. The GLOBAL rule may still allow `peer_to_peer` — low/medium categories legitimately use it; high ones are covered by the read-time veto.
  - Why it mattered (82): a direct payer→helper transfer (Pix included) puts the helper's name on the payer's bank record — handing the reporter the identity of the person the platform is sworn to hide, in the highest-retaliation-risk categories. The independent hard veto in `PaymentIntent` (task 30, not yet built) remains planned as defense in depth.
- Consumed by: admin task 07 (`FeeRuleEntity`, repository, monetization config page).
- **Forward note (decision 81)**: `paymentModeAllowed`'s `intermediated` now means *intermediated by a licensed third-party PSP* — VGR never holds funds, and the platform's `feePercent` must be collected as a split leg executed by the PSP, never as retention of money VGR custodies. The enum is deliberately left unchanged: which party executes the rail belongs to the `PaymentRail` adapter (Reward's Anti-Corruption Layer), not to this config. When `PaymentIntent` (task 30) is built, it consumes `feePercent` as the split percentage and must not introduce any balance-holding step. Custody model is still a pending round-3 item.

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows, and the no-cross-module-import rule this task's known gap runs into.
- [**risk-config.md**](./risk-config.md): sibling admin-config feature, same TTL-cache/default-value pattern.
