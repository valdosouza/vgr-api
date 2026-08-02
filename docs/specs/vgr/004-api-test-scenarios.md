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
- [ ] Should reject allocate() when the target Report is not yet Resolved
- [ ] Should reject allocate() when the caller is not the Report's reporterId (decision 30)
- [ ] Should emit RewardAllocated when allocate() succeeds

**UserIdentity**
- [ ] Should allow Role transition from none to reporter or helper
- [ ] Should reject Role transition to police (deferred, decision 12)

**AccountabilityLogEntry**
- [ ] Should be immutable after creation
- [ ] Should never be serializable through any DTO used by a controller (structural check)

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

### 1.4 Domain Events

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

### 3.2 Alternative and Error Flows

- [ ] Should return 403 when a Helper who is also the Report's Reporter attempts to submit a HelpOffer on their own Report
- [ ] Should return 422 with the standardized error body when SubmitReport is called with both Category and FreeTag null
- [ ] Should return 404 with the project-standard message when a Report id does not exist
- [ ] Should return 403 when a non-Reporter caller attempts to allocate a Reward
- [ ] Should return 409 when attempting to resolve() a Report that is already Resolved

### 3.3 Security Scenarios

- [ ] Should reject input containing SQL injection / XSS / command injection at the Zod validation boundary for every module's `.dto.ts`
- [ ] Should block a FreeTag value exceeding 50 characters and any numeric field (e.g. radius, weight) outside its permitted range
- [ ] Should exclude AccountabilityLogEntry fields (IP, metadata) from every API response, error payload, and emitted event
- [ ] Should prevent a Helper from accessing or modifying a HelpOffer belonging to another Helper
- [ ] Should apply Brazilian jurisdiction rules regardless of the request's originating location/IP (decision 24) — no geo-adaptive behavior branch exists

## Save

Saved to: `D:\ProjetoVGR\api\docs\specs\vgr\004-api-test-scenarios.md`
