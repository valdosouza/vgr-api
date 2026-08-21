# Reward (R0 — first slice)

## OVERVIEW
Monetary reward guarantee for a report (decisions 1, 30, 81–102, 143–147). A reward is offered unreserved from creation (decision 88's first option); the reporter later reserves via Pix against a recipient set that is **fixed at that moment** (decision 147) — mediation judges whether the condition was fulfilled for that fixed set, it does not discover recipients. Plan/decision log: `AI/docs/decisions/VGR-plano.md` (decisions 147, and the reward block at 81–102); PSP connector: `api/docs/feature/payment-rail.md`.

**Scope is deliberately narrow (R0)**: monetary reward only. Decision 1's broader "flexible, not necessarily financial" reward is not modeled here — `tb_reward_offer` only exists once money is involved.

## STRUCTURE
```
src/modules/reward/
├── reward.interface.ts        # Row/Input types
├── reward.dto.ts               # Zod validation
├── reward.repository.ts        # pure SQL, findReportForOffer reads tb_report
│                               #   directly (no cross-module import)
├── reward.service.ts           # business rules — see KEY BEHAVIORS
├── reward.controller.ts        # HTTP <-> service, two surfaces (below)
├── reward.routes.ts            # app plane: /app-reward
├── reward-mediation.routes.ts  # panel plane: /api/reward-mediation
└── __tests__/reward.service.spec.ts

src/migrations/sql/035_reward.sql   # tb_reward_offer, tb_reward_recipient,
                                    # tb_reward_recipient_profile, reward_mediation interface
```

Mounted at `/app-reward` (app.ts, behind `appAuthMiddleware` — every route needs an identified account, decisions 60/82 govern disclosure to OTHER parties, not the payer's own PSP KYC) and `/api/reward-mediation` (gateway/router.ts, behind `requirePrivilege(REWARD_MEDIATION, UPDATE)`).

## KEY BEHAVIORS
- **`offerReward`**: only the report's own reporter, only once per report (`tb_reward_offer` has a unique key on `tb_report_id`). Asserts `reward.offer` and `reward.monetary` (Legal Gate) — both wired here, removed from `PENDING_WIRING`.
- **`reserveGuarantee`** (decision 147 — the only place recipients are ever chosen): validates recipient amounts sum to the offer amount, that every `helpOfferId` belongs to the report, that the targeted helper is identified (decision 34's precedent: an anonymous helper cannot receive money), and that the helper has a `tb_reward_recipient_profile` row (onboarded to the rail). Calls `paymentRail().reserve(...)`, then writes the offer's `reserved` transition and the recipient rows in one DB transaction. Asserts `reward.intermediation.delegated`.
- **`resolveReward`** (decision 98/147 — mediation): `fulfilled` calls `paymentRail().capture()` and marks the fixed recipients `paid`; `not_fulfilled` calls `paymentRail().cancel()` and refunds the payer (decision 100 point 3 — devolver is first-class; decision 92 only forbids reversal *after* a release). Asserts `reward.mediation`.
- **`getRewardState`** (decision 85 — the seal must derive from the LIVE rail state): on read, if the offer is `reserved`, calls `paymentRail().getRetentionState()` and reconciles the stored status on drift (e.g. Asaas's `daysToExpire` auto-release) — no expiration job needed for this.
- **`onboardAsRecipient`** (`POST /app-reward/onboarding`, plus a `GET` status check): the helper hands their KYC data to the rail (their own PSP — decisions 60/82 govern disclosure to OTHER parties, not this), which opens the subconta a future split will target. The VGR stores only the opaque `railRecipientId` in `tb_reward_recipient_profile` (decision 143) — none of the KYC input is persisted or logged. One profile per account (409 on repeat). Asserts `reward.monetary` and `reward.intermediation.delegated` BEFORE any data leaves the platform (fail-closed, decision 104).

## DELIBERATELY NOT BUILT IN THIS SLICE (documented, not silently skipped)
- **Mediation criteria publication / dual control above a value threshold** (decision 98's full discipline) — `resolveReward` only checks a privilege today, not published-in-advance criteria or a second approver.
- **Chargeback repasse** (decision 102) — Pix has no chargeback; only a MED (fraud) edge case exists and is unhandled.
- **Expiration job** (decisions 89/90, pending D1) — not needed for Pix per decision 95's note; `getRewardState`'s live-check covers the seal honesty requirement (85) without one.
- **Onboarding UI** — the API endpoint above exists (added after R0), but no mobile screen drives it yet.
- **Non-monetary reward** (decision 1's broader concept) — out of scope for this table entirely.
- **Growing a reservation after the fact** (e.g. a helper shows up after reserving) — decision 147 flags this as open, not MVP; today it would need cancel + a fresh offer.

## OPEN DEPENDENCY
`AsaasPaymentRail` is a research candidate, not the closed decision 59 (see `payment-rail.md`). This module calls `paymentRail()` through the port — nothing here assumes Asaas specifically — but do not point any of this at a real reservation before B2–B5/D1 are confirmed.
