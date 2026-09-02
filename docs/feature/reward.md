# Reward (R0 + mediation discipline)

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
src/migrations/sql/036_reward_mediation.sql  # tb_mediation_criteria, tb_reward_resolution,
                                             # tb_reward_contest, tb_reward_mediation_log,
                                             # tb_reward_offer.criteria_version
```

Mounted at `/app-reward` (app.ts, behind `appAuthMiddleware` — every route needs an identified account, decisions 60/82 govern disclosure to OTHER parties, not the payer's own PSP KYC) and `/api/reward-mediation` (gateway/router.ts, behind `requirePrivilege(REWARD_MEDIATION, UPDATE)`).

## KEY BEHAVIORS
- **`offerReward`**: only the report's own reporter, only once per report (`tb_reward_offer` has a unique key on `tb_report_id`). Asserts `reward.offer` and `reward.monetary` (Legal Gate) — both wired here, removed from `PENDING_WIRING`.
- **`reserveGuarantee`** (decision 147 — the only place recipients are ever chosen): validates recipient amounts sum to the offer amount, that every `helpOfferId` belongs to the report, that the targeted helper is identified (decision 34's precedent: an anonymous helper cannot receive money), and that the helper has a `tb_reward_recipient_profile` row (onboarded to the rail). **Requires published mediation criteria and stamps the active version on the offer (decision 150) — no criteria, no reserve (`NOT_AVAILABLE`).** Calls `paymentRail().reserve(...)`, then writes the offer's `reserved` transition and the recipient rows in one DB transaction. Asserts `reward.intermediation.delegated`.
- **Mediation discipline** (decision 98, closed by decisions 148/149/150; migration 036): the single-step `resolveReward` was replaced by the full cycle — the rail is only ever touched by `executeResolution`:
  1. **`publishCriteria`** (`POST /api/reward-mediation/criteria`): append-only immutable versions (`tb_mediation_criteria`); correcting means publishing a new version. The app exposes the active one at `GET /app-reward/mediation-criteria` (the rules of the game, decision 150).
  2. **`proposeResolution`** (mediator A): outcome + reason, judged by the criteria version stamped on the offer. At most one live resolution per offer.
  3. **`approveResolution`** (mediator B — **must be a different user**, decision 148, no value threshold): opens the contest window (`MEDIATION_CONTEST_WINDOW_DAYS`, default 7 — must fit inside the rail's retention period). Does not touch the rail.
  4. **`contestResolution`** (`POST /app-reward/{reportId}/contest`, app plane): only the case's parties — the payer (reporter) and the fixed recipients' helpers — while the money is still retained (decision 149: the only contest with a real remedy, since a released Pix never returns per decision 92). An open contest blocks execution; `closeContest` (panel) closes it with a note.
  5. **`executeResolution`**: window elapsed + no open contest → `fulfilled` calls `paymentRail().capture()` and marks the fixed recipients `paid`; `not_fulfilled` calls `paymentRail().cancel()` and refunds the payer (decision 100 point 3). `cancelResolution` abandons a live proposal so a new cycle can start.
  Every step lands in `tb_reward_mediation_log` — append-only, no update/delete path in code (pattern of decision 76). All mediator actions assert `reward.mediation`.
- **`getRewardState`** (decision 85 — the seal must derive from the LIVE rail state): on read, if the offer is `reserved`, calls `paymentRail().getRetentionState()` and reconciles the stored status on drift (e.g. Asaas's `daysToExpire` auto-release) — no expiration job needed for this.
- **`onboardAsRecipient`** (`POST /app-reward/onboarding`, plus a `GET` status check): the helper hands their KYC data to the rail (their own PSP — decisions 60/82 govern disclosure to OTHER parties, not this), which opens the subconta a future split will target. The VGR stores only the opaque `railRecipientId` in `tb_reward_recipient_profile` (decision 143) — none of the KYC input is persisted or logged. One profile per account (409 on repeat). Asserts `reward.monetary` and `reward.intermediation.delegated` BEFORE any data leaves the platform (fail-closed, decision 104).

## DELIBERATELY NOT BUILT IN THIS SLICE (documented, not silently skipped)
- **Chargeback repasse** (decision 102) — Pix has no chargeback; only a MED (fraud) edge case exists and is unhandled.
- **Expiration job** (decisions 89/90, pending D1) — not needed for Pix per decision 95's note; `getRewardState`'s live-check covers the seal honesty requirement (85) without one.
- **Tax ids (`taxId` on onboarding, `payerTaxId` on reserve) — decision 155 (2026-09-02)**: `brTaxIdSchema` in `br-tax-id.ts` accepts digits only (11 = CPF, 14 = CNPJ) and verifies the check digits, so an invalid document never reaches the PSP. Both failures surface as field code `INVALID_FORMAT` (decision 83; `zodToFields` now honours a refinement's `params.code`). The app's `vgr_validators` mirrors these functions test by test (decision 154) — change both sides together.
- ~~Onboarding UI~~ **BUILT in 2026-08-21**: `app/modules/reward_onboarding` in `apps/mobile` — see `app/docs/feature/reward-onboarding.md`.
- **Non-monetary reward** (decision 1's broader concept) — out of scope for this table entirely.
- **Growing a reservation after the fact** (e.g. a helper shows up after reserving) — decision 147 flags this as open, not MVP; today it would need cancel + a fresh offer.

## OPEN DEPENDENCY
`AsaasPaymentRail` is a research candidate, not the closed decision 59 (see `payment-rail.md`). This module calls `paymentRail()` through the port — nothing here assumes Asaas specifically — but do not point any of this at a real reservation before B2–B5/D1 are confirmed.
