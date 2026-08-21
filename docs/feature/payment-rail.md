# Payment rail (PSP connector — research candidate, decision 59 NOT closed)

## OVERVIEW
`PaymentRail` port (decisions 96, 100, 143): domain-shaped interface for retaining a payer's Pix charge, split across N recipients, later released to them or refunded to the payer — no PSP-specific concept (walletId, escrow id, subconta) ever leaks past `shared/payment/`. Built ahead of the Reward module so the connector is ready when the module is opened, per Valdo's instruction — **nothing in the codebase calls this port yet**.

`AsaasPaymentRail` is the only implementation, and it is a **research candidate found while working the decision-59 checklist** (`AI/docs/plans/plano-psp-requisitos.md`), not the closed vendor choice. Do not treat its presence as "Asaas decided" — see the checklist status below.

## STRUCTURE
```
src/shared/payment/
├── payment-rail.ts            # port interface + paymentRail() factory (memoized, PAYMENT_RAIL-style
│                              #   selection — only 'asaas' exists today)
├── asaas-payment-rail.ts      # Asaas adapter; header comment lists confirmed vs assumed endpoints
└── __tests__/                 # factory + adapter specs, fetch mocked (no network, no sandbox call)
```

`paymentConfig()` in `shared/config/env.ts`. Env: `ASAAS_API_URL` (sandbox by default), `ASAAS_API_KEY`, `ASAAS_ESCROW_DAYS_TO_EXPIRE`.

## CONFIRMED vs UNCONFIRMED (checklist state, plano-psp-requisitos.md §1-2)
Confirmed from `docs.asaas.com` (fetched 2026-08-20):
- **B1 — titularity**: retained value sits inside the **recipient's own subconta** (`POST /v3/accounts` → `walletId`), not a VGR-titled account. This is the fact that made Asaas worth building a candidate adapter for.
- Split (`POST /v3/payments`, `split[].walletId`) and Conta Escrow (`POST /v3/accounts/{id}/escrow`, `GET /v3/payments/{id}/escrow`, `POST /v3/escrow/{id}/finish`) each documented independently.

Still **open**, do not point this adapter at a real charge before these are confirmed directly with Asaas:
- **B2/B3**: whether split and escrow retention compose on the *same* charge — never verified together in the docs.
- **B4**: refund of a charge still under escrow retention. `POST /v3/payments/{id}/refund` documents Pix refund generally, and the escrow status schema has `finishReason: PAYMENT_REFUNDED`, but no page confirms the combination explicitly.
- **B5**: whether the payer's receipt/statement names the recipient (decision 82 requires it does not) — not researched yet.
- **D1**: `daysToExpire` is the only documented retention cap — no confirmation of a contractual maximum.

Method names (`reserve` / `capture` / `cancel`) follow the vocabulary decision 87 mandates for this port.

## KEY BEHAVIORS
- `onboardRecipient`: creates the subconta, then enables escrow on it in a second call — escrow only retains charges received *after* it is enabled, so this order is load-bearing.
- `reserve`: resolves (or creates) an Asaas customer by the payer's `taxId` before charging — Asaas requires a `customer` id, decision 100's payer has no such id otherwise.
- `capture`: looks up the per-charge escrow id via `GET /v3/payments/{id}/escrow`, then calls `finish` — no-op if already `DONE`.
- `cancel`: calls the standard payment refund endpoint directly (not the escrow `finish` endpoint, which has no destination parameter).
- `getRetentionState`: maps Asaas's `status`/`finishReason` to the port's `RetentionState` — `PAYMENT_REFUNDED` → `refunded`, `EXPIRED`/`CUSTOMER_CONFIG_DISABLED` → `released`, anything else while `DONE` → `unknown` (surfaces as a gap to investigate, never silently mapped to a wrong state).

## RESOLVED tension: recipients are fixed at reserve time (decision 147)
`reserve` requires `recipients` up front, because that is what Asaas's split actually requires (set at charge creation — confirmed). This once looked incompatible with decision 100 point 2 ("mediation chooses the helpers who fulfilled the condition" — read as happening at release time). **Decision 147 amends this**: the reward flow now fixes the recipient set at `reserve` time, not at mediation time — a reward exists unreserved from creation, and "reserving via Pix" is a later action taken once the denunciante already knows who they want to guarantee, referencing existing help offers. Mediation's job shrinks to judging whether the condition was fulfilled for that fixed set (`capture`) or not (`cancel`), not discovering new recipients. See `AI/docs/decisions/VGR-plano.md` decision 147 for the full reasoning.

## NEXT STEPS (not started)
1. Confirm B2-B5/D1 directly with Asaas (checklist §4) — turns "candidate" into "decision 59".
2. Reward domain module opened — see `api/docs/feature/reward.md`.
