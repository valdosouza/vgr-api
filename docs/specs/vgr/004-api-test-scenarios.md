# Test Scenarios — api

**Domain:** vgr
**Project:** api
**Framework:** Jest 29 + ts-jest, supertest (per `docs/adr/TESTS.md`)

## 1. Unit Tests

### 1.1 Aggregates and Aggregate Roots

**Report**
- [ ] Should create Report successfully when Category is provided and FreeTag is null
- [ ] Should create Report successfully when FreeTag is provided and Category is null
- [ ] Should reject creation when both Category and FreeTag are null
- [ ] Should initialize Report in an unresolved state when created
- [ ] Should transition Report to Resolved when resolve() is called on an unresolved Report
- [ ] Should reject resolve() when Report is already Resolved
- [ ] Should append a ReportTimelineEvent when edit() is applied
- [ ] Should emit ReportResolved when resolve() succeeds
- [ ] Should emit ReportEdited when edit() succeeds

**HelpOffer**
- [ ] Should create HelpOffer successfully when helperId differs from the target Report's reporterId
- [ ] Should reject creation when helperId equals the target Report's reporterId (SelfDealingError, decision 20)
- [ ] Should emit HelpOfferSubmitted when creation succeeds

**DirectionEstimate**
- [ ] Should initialize DirectionEstimate with an even 50/50 prior between the two reported directions when the first Sighting arrives
- [ ] Should reweight probabilityByDirection when applySighting() is called with an additional Sighting
- [ ] Should reject a weight update that would make probabilityByDirection sum to a value other than 1.0

**Reward**
- [ ] Should create Reward successfully when offer is one of money, perk, reciprocity, or none
- [ ] Should reject Reward creation when the Reporter's AnonymityMode is anonymous (decision 33)
- [ ] Should reject allocate() when the target Report is not yet Resolved
- [ ] Should reject allocate() when the caller is not the Report's reporterId (decision 30)
- [ ] Should split the reward evenly across all RewardClaims when allocate() is called with more than one claimId without a custom split (CC art. 860, decision 30)
- [ ] Should emit RewardAllocated when allocate() succeeds
- [ ] Should reject revoke() once any qualifying HelpOffer already exists for the Report (CC art. 856, decision 30)
- [ ] Should allow revoke() successfully when no qualifying HelpOffer exists yet

**UserAccount**
- [ ] Should complete registration successfully when consent is recorded and Jurisdiction defaults to BR (decision 8, 24)
- [ ] Should reject registration when consent is not recorded
- [ ] Should upsert (not duplicate) the UserAccount when the same LoginProvider identity authenticates twice (decision 31)

**UserIdentity**
- [ ] Should allow Role transition from none to reporter or helper
- [ ] Should reject Role transition to police (deferred, decision 12)

**AccountabilityLogEntry**
- [ ] Should be immutable after creation
- [ ] Should never be serializable through any DTO used by a controller (structural check)

**AdminAccount** (amendment, task 33, decision 67)
- [ ] Should authenticate successfully when the password matches the stored bcrypt hash
- [ ] Should reject authentication when the password doesn't match
- [ ] Should never expose passwordHash through any DTO used by a controller (structural check, mirrors AccountabilityLogEntry)

**RiskTierConfig**
- [ ] Should create successfully for any Category with tier one of low/medium/high
- [ ] Should be readable from cache without a query on every request (TTL-cached, decision 46)

**CategoryFormSchema**
- [ ] Should create successfully with a non-empty field list for a Category
- [ ] Should reject a submitted Report's detail fields that don't match the current schema

**FeeRule** (amendment, task 32 — see `003-api-tactical-design.md` task 32's note)
- [ ] Should create successfully for a specific Category or for the global default (category=null)
- [ ] Should be readable from cache without a query on every request (TTL-cached, mirrors decision 46's pattern)
- [ ] Should fall back to the global default rule when the requested Category has no rule of its own

**HelperRating**
- [ ] Should persist against the Helper's internal id even when the Helper was anonymous to the Reporter
- [ ] Should reject a second rating on the same HelpOffer from the same Reporter

**PanicAlert**
- [ ] Should reject trigger() when recipients resolves to an empty set even after defaulting to the responder pool
- [ ] Should accept trigger() with only a trusted contact configured, no pool membership required

**ChatThread**
- [ ] Should resolve every participant through MaskedIdentity before persisting a message — never a raw UserId
- [ ] Should generate a distinct MaskedIdentity token per (ChatThread, UserId) pair, never reused across Reports

**PaymentIntent**
- [ ] Should reject confirm() with mode=peer_to_peer when the Report's RiskTierConfig is high
- [ ] Should accept confirm() with mode=peer_to_peer when the Report's RiskTierConfig is low or medium

**DualControlAccessRequest**
- [ ] Should remain ungrantable with only 1 recorded approverId, even with a valid legalBasis
- [ ] Should reject recording the same approverId twice toward the 2-approver threshold
- [ ] Should become grantable only when 2 distinct approverIds and a non-empty legalBasis are present

### 1.2 Value Objects

**Category / FreeTag**
- [ ] Should create Category successfully when value is in the curated taxonomy
- [ ] Should reject Category when value is outside the curated taxonomy
- [ ] Should create FreeTag successfully when Category is null and value is non-empty and ≤ 50 chars
- [ ] Should consider two Category instances equal when they hold the same value

**DynamicRadius**
- [ ] Should create DynamicRadius successfully when value is a positive float
- [ ] Should reject DynamicRadius when value is zero or negative

**SightingWeight**
- [ ] Should create SightingWeight successfully when value is between 0 and 1 inclusive
- [ ] Should produce a lower SightingWeight for an anonymous reporterRole than for an identified one (decision 27)

**RewardOffer**
- [ ] Should create RewardOffer successfully for each of the four kinds: money, perk, reciprocity, none
- [ ] Should reject a money RewardOffer when amount is zero or negative

**Role / AnonymityMode**
- [ ] Should create Role successfully for each of: anonymous, reporter, helper, police
- [ ] Should reject an AnonymityMode of identified_with_reward when no completed UserAccount registration exists (decision 4)

### 1.3 Domain Services

**CalculateDynamicRadius**
- [ ] Should return a larger radius for lost-pet-style Categories than for domestic-violence-style Categories (decision 7)
- [ ] Should fail when given a Category outside the curated taxonomy
- [ ] Should carry no state between executions (pure function)

**ReconcileDirectionEstimate**
- [ ] Should shift probabilityByDirection toward the direction with more, higher-weighted Sightings
- [ ] Should fail when given a Sighting for a Report that has no existing DirectionEstimate
- [ ] Should carry no state between executions

### 1.4 Retention Job

**Child-tagged Report data retention (decision 25)**
- [ ] Should schedule deletion of a Child-tagged Report's sensitive fields exactly 90 days after ReportResolved
- [ ] Should leave a non-Child-tagged Report's data untouched by the retention job
- [ ] Should not delete data before the 90-day window has elapsed, verified with a mocked clock

### 1.5 Domain Events

- [ ] Should contain reportId, category, position, and submittedAt after ReportSubmitted is emitted
- [ ] Should contain reportId and resolvedAt after ReportResolved is emitted
- [ ] Should auto-generate a timestamp and prevent mutation on every emitted event
- [ ] Should be immutable after creation for ReportEdited, HelpOfferSubmitted, DirectionSightingLogged, RewardOffered, RewardAllocated

## 2. Integration Tests

### 2.1 Repositories

**ReportRepository**
- [ ] Should persist and retrieve a Report with Category, FreeTag, and timeline intact
- [ ] Should reflect the Resolved state after save() following resolve()
- [ ] Should confirm absence of a Report after soft deletion (deleted='S')
- [ ] Should return empty result (not throw) when searching by a non-existent ReportId
- [ ] Should persist only one version when two concurrent resolve() calls race (optimistic handling)
- [ ] Should return correctly paginated, ordered results from listNearby() for recency and for relevance ordering

**HelpOfferRepository**
- [ ] Should persist and retrieve a HelpOffer with its chosen HelpType intact
- [ ] Should return all HelpOffers linked to a Report after that Report is Resolved (decision 18)

**DirectionEstimateRepository**
- [ ] Should persist the updated probabilityByDirection after each applySighting() call
- [ ] Should fully roll back without partial state if a mid-transaction failure occurs during reconciliation

**RewardRepository**
- [ ] Should persist and retrieve a Reward with an opaque reportId reference only, no denormalized Category/Tags
- [ ] Should reject allocate() persistence when the referenced Report is not Resolved

**AccountabilityLogRepository**
- [ ] Should append an entry for every anonymous Report/HelpOffer submission
- [ ] Should never be queryable through any repository method used by a public-facing controller

**RiskTierConfigRepository**
- [ ] Should persist an admin's tier update and reflect it after the next TTL cache refresh
- [ ] Should return the configured tier, not a default, for a Category that was explicitly set

**FeeRuleRepository** (amendment, task 32)
- [ ] Should persist an admin's feePercent/paymentModeAllowed update and reflect it after the next TTL cache refresh
- [ ] Should return the Category-specific rule, not the global one, when both exist for that Category

**ResponderPoolRepository**
- [ ] Should return only actively approved members when queried for panic-alert routing
- [ ] Should exclude a denied or revoked membership from the active members list

**PanicAlertRepository / ChatThreadRepository / PaymentIntentRepository**
- [ ] Should persist a PanicAlert with its resolved recipient list intact
- [ ] Should find-or-create exactly one ChatThread per (reportId, helperId) pair, never duplicating on repeated calls
- [ ] Should persist a PaymentIntent's mode and confirmation state accurately

**DualControlAccessRepository**
- [ ] Should append each approval attempt (granted or denied) permanently, including both approver identities on grant

### 2.2 Use Cases

**SubmitReport → ReportRepository**
- [ ] Should execute SubmitReport → Report created → ReportSubmitted emitted → persisted successfully
- [ ] Should reject an invalid SubmitReport command before any persistence occurs (no side-effects)

**SubmitHelpOffer → HelpOfferRepository**
- [ ] Should execute SubmitHelpOffer → HelpOffer created → HelpOfferSubmitted emitted → persisted successfully
- [ ] Should reject SubmitHelpOffer before persistence when helperId equals the Report's reporterId

**LogDirectionSighting → DirectionEstimateRepository**
- [ ] Should execute LogDirectionSighting → DirectionEstimate reconciled → persisted → response returned, all within one synchronous request (decision 22)
- [ ] Should produce a consistent DirectionEstimate when the same Sighting is submitted twice (idempotency, if a client retries after a timeout)

**AllocateReward → RewardRepository**
- [ ] Should execute AllocateReward → Reward updated → RewardAllocated emitted → persisted, only when Report is Resolved and caller is the Reporter
- [ ] Should rollback fully without leaving inconsistent state if persistence fails mid-allocation

**AuthenticateWithProvider → UserAccountRepository**
- [ ] Should execute AuthenticateWithProvider → provider token verified → UserAccount upserted → UserAuthenticated emitted → JWT issued, for each of Google, Apple, Facebook
- [ ] Should reject before any persistence when the provider token fails verification
- [ ] Should execute the OTP variant → code verified against a non-expired, unused record → JWT issued

**TriggerPanicAlert → PanicAlertRepository**
- [ ] Should execute TriggerPanicAlert → recipients resolved (config or default pool) → PanicAlertTriggered emitted → persisted
- [ ] Should execute end-to-end for a cold trigger (no prior configuration) and still resolve to the responder pool

**ProcessRewardPayment → PaymentIntentRepository**
- [ ] Should execute ProcessRewardPayment → RiskTier checked → intermediated path taken → PaymentIntentConfirmed emitted, for a high-tier Report
- [ ] Should reject before any persistence when a peer_to_peer PaymentIntent is attempted on a high-tier Report

**RequestDualControlAccess → DualControlAccessRepository**
- [ ] Should execute the full 2-approval sequence → DualControlAccessGranted emitted only after the second distinct approval

**AdminLogin → AdminAccountRepository** (amendment, task 33, decision 67)
- [ ] Should execute AdminLogin → credentials verified against AdminAccountRepository → JWT issued with role=admin
- [ ] Should reject before issuing a JWT when the email doesn't match any AdminAccount

**RequestResponderAuthorization / ApproveResponderAuthorization → ResponderPoolRepository** (amendment, task 27 — these two use cases were listed in `003-api-tactical-design.md`'s Use Case Catalog but had no GWT coverage here; adding it rather than inventing untracked test cases)
- [ ] Should execute RequestResponderAuthorization → ResponderPoolMembership created with status=pending → persisted, regardless of caller Role
- [ ] Should execute ApproveResponderAuthorization(approved: true) → membership status transitions to approved → persisted, becomes visible to `findActiveMembers`
- [ ] Should execute ApproveResponderAuthorization(approved: false) → membership status transitions to denied → persisted, excluded from `findActiveMembers`

### 2.3 External Integrations

> No external integrations are mapped in `002-context-map.md` for the api project at MVP scope — Geolocation Primitives and the Payment/Perk Provider are stubbed/future (see 001-problem-space.md notes). Marked N/A pending those decisions.

## 3. Functional Tests

### 3.1 Happy Path Flows

- [ ] **Should return 201 with the created Report when a Reporter submits a valid Report**
  - Given: an authenticated or anonymous actor with a valid Category
  - When: `POST /api/reports` is called with `{ category, freeTag: null, position }`
  - Then: response is 201 with `{ ok: true, data: { id, ... } }`; a ReportSubmitted event is recorded

- [ ] **Should return the paginated NearbyReportsFeed when a Helper requests nearby Reports**
  - Given: several Reports exist within and outside the caller's Dynamic Radius for their Category
  - When: `GET /api/reports?position=...&page=1&orderBy=recency` is called
  - Then: response contains only Reports within radius, paginated, ordered by submission recency

- [ ] **Should register a HelpOffer when a Helper (not the Reporter) submits one**
  - Given: an existing Report with reporterId = R, and a caller with userId = H (H ≠ R)
  - When: `POST /api/help-offers` is called with `{ reportId, helpType }`
  - Then: response is 201; HelpOfferSubmitted is emitted

- [ ] **Should log a Direction Sighting and return the updated estimate synchronously**
  - Given: an existing Report with an active DirectionEstimate at 50/50
  - When: `POST /api/direction-sightings` is called with `{ reportId, direction, reporterRole }`
  - Then: response is 201 and includes the reconciled probabilityByDirection in the same request/response cycle

- [ ] **Should resolve a Report and notify linked HelpOffers**
  - Given: an existing Report with 2 linked HelpOffers
  - When: `PUT /api/reports/:id/resolve` is called by the Reporter
  - Then: response is 200; ReportResolved is emitted; both HelpOffers remain linked (decision 18)

- [ ] **Should allow only the Reporter to allocate a Reward after resolution**
  - Given: a Resolved Report with an active RewardOffer and 2 RewardClaims
  - When: `POST /api/rewards/:id/allocate` is called by the Reporter with a subset of claimIds
  - Then: response is 200; RewardAllocated is emitted with the chosen claimIds

- [ ] **Should issue a JWT when a user authenticates with Google, Apple, or Facebook**
  - Given: a valid provider token obtained from the client SDK
  - When: `POST /auth/login` is called with `{ provider, token }`
  - Then: response is 200 with `{ jwt }`; UserAuthenticated is emitted

- [ ] **Should issue a JWT when a user completes phone/WhatsApp OTP login**
  - Given: an OTP code was requested via `POST /auth/login/otp/request`
  - When: `POST /auth/login/otp/verify` is called with the correct, non-expired code
  - Then: response is 200 with `{ jwt }`

- [ ] **Should issue a JWT when an admin logs in with the correct email/password** (amendment, task 33, decision 67)
  - Given: a seeded AdminAccount
  - When: `POST /auth/admin-login` is called with `{ email, password }`
  - Then: response is 200 with `{ jwt }` decodable to `{ userId, role: "admin" }`

- [ ] **Should hide real-time engagement signals from the Reporter on a high-tier Report**
  - Given: a Report whose Category has RiskTierConfig=high, with 2 HelpOffers submitted in the last minute
  - When: the Reporter calls `GET /api/reports/:id`
  - Then: response omits per-HelpOffer timestamps/counts in real time (decision 41)

- [ ] **Should let an admin update a Category's RiskTier without a deploy**
  - Given: an authenticated admin
  - When: `PUT /api/risk-config/:category` is called with `{ tier: "high" }`
  - Then: response is 200; subsequent Report submissions in that Category enforce mandatory anonymity and hidden engagement

- [ ] **Should let an admin set a Category's fee rule, falling back to the global default when unset** (amendment, task 32)
  - Given: an authenticated admin, and a Category with no fee rule of its own yet
  - When: `GET /api/monetization-config/:category` is called, then `PUT /api/monetization-config/:category` with `{ feePercent: 5, paymentModeAllowed: ["intermediated"] }`, then `GET` again
  - Then: the first response reflects the global default; the third reflects the Category-specific override, without a deploy

- [ ] **Should restrict a Resolved Report's detail to participants only**
  - Given: a Resolved Report with 1 linked HelpOffer, and a caller with no HelpOffer on it
  - When: that caller calls `GET /api/reports/:id`
  - Then: response contains only the closure status, no timeline/ratings (decision 50)

- [ ] **Should let a user request Authorized Responder status and an admin approve it** (amendment, task 27 — same gap as noted in section 2.2)
  - Given: an authenticated user with no existing ResponderPoolMembership
  - When: `POST /api/panic/responder-pool` is called by that user, then `PUT /api/panic/responder-pool/:id/resolve` with `{ approved: true }` is called by an admin
  - Then: the first response is 201 with status=pending; the second is 200 and the membership no longer appears in the admin's pending list

- [ ] **Should trigger a panic alert and resolve to the responder pool when unconfigured**
  - Given: a user with no PanicAlert configuration saved
  - When: `POST /api/panic/trigger` is called
  - Then: response is 201; PanicAlertTriggered is emitted with the active responder pool as recipients (decision 65)

- [ ] **Should post and retrieve masked chat messages on a Report's thread**
  - Given: an existing Report with a HelpOffer from Helper H
  - When: `POST /api/chat/:reportId/messages` is called by H, then `GET /api/chat/:reportId/messages` by the Reporter
  - Then: the Reporter's response shows H's message under a MaskedIdentity token, never H's raw UserId

### 3.2 Alternative and Error Flows

- [ ] Should return 403 when a Helper who is also the Report's Reporter attempts to submit a HelpOffer on their own Report
- [ ] Should return 422 with the standardized error body when SubmitReport is called with both Category and FreeTag null
- [ ] Should return 404 with the project-standard message when a Report id does not exist
- [ ] Should return 403 when a non-Reporter caller attempts to allocate a Reward
- [ ] Should return 409 when attempting to resolve() a Report that is already Resolved
- [ ] Should return 401 when `/auth/login` is called with an invalid or expired provider token
- [ ] Should return 401 when the OTP code is wrong, expired, or already used
- [ ] Should return 401 with the same message for a wrong password and for an unknown email on `POST /auth/admin-login` (amendment, task 33 — never reveal which one was wrong)
- [ ] Should return 422 when a non-registered (anonymous) Reporter attempts `POST /api/rewards` to offer a Reward (decision 33)
- [ ] Should return 409 when attempting to revoke() a Reward after a qualifying HelpOffer already exists (decision 30)
- [ ] Should return 422 when a PaymentIntent with mode=peer_to_peer is requested for a high-tier Report (decision 58)
- [ ] Should return 403 when a non-admin caller attempts any `/api/risk-config/*`, `/api/category-forms/*`, `/api/dual-control-access/*`, `/api/monetization-config/*` (amendment, task 32), or admin-only `/api/panic/responder-pool/*` endpoint (list/resolve — request stays open to any authenticated Role)
- [ ] Should return 409 when a second approval attempt on `/api/dual-control-access/:id` reuses an approverId already recorded on that request

### 3.3 Security Scenarios

- [ ] Should reject input containing SQL injection / XSS / command injection at the Zod validation boundary for every module's `.dto.ts`
- [ ] Should block a FreeTag value exceeding 50 characters and any numeric field (e.g. radius, weight) outside its permitted range
- [ ] Should exclude AccountabilityLogEntry fields (IP, metadata) from every API response, error payload, and emitted event
- [ ] Should prevent a Helper from accessing or modifying a HelpOffer belonging to another Helper
- [ ] Should apply Brazilian jurisdiction rules regardless of the request's originating location/IP (decision 24) — no geo-adaptive behavior branch exists
- [ ] Should rate-limit OTP request attempts per phone number to prevent SMS/WhatsApp abuse
- [ ] Should never log or return the raw OTP code in any response, error, or log line other than the delivery channel itself
- [ ] Should never resolve a MaskedIdentity token back to a raw UserId through any endpoint reachable by a Reporter or another Helper
- [ ] Should grant AccountabilityLogEntry decryption only with a logged legalBasis and 2 distinct admin approverIds — never with 1, never with a duplicated approver
- [ ] Should exclude FeeRuleEntity and RiskTierConfig write endpoints from any Role other than admin, including a valid but non-admin JWT

## Save

Saved to: `D:\ProjetoVGR\api\docs\specs\vgr\004-api-test-scenarios.md`
