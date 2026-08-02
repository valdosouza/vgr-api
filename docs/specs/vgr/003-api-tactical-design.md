# Tactical Design — api
**Domain:** vgr | **Project:** api

> Backend architecture: Express/TypeScript module pattern (`interface → dto → repository → service → controller → routes`), per `docs/adr/ARCHITECTURE.md`. DDD constructs (Aggregates, VOs) map onto `<m>.interface.ts`/`<m>.service.ts`; they do not replace the module pattern.

## Section 1 — Main Structure

| Element | Layer / Type | Invariants / Tech Rules | 4-line Snippet |
|---|---|---|---|
| Report | Aggregate Root | Must have Category or FreeTag; cannot be Resolved twice; if SubjectTag=Child, data auto-deletes 90 days after resolution (decision 25) | *see below* |
| HelpOffer | Aggregate Root | Reporter of the target Report cannot also be its Helper (decision 20) | *see below* |
| DirectionEstimate | Aggregate Root | Weight recalculates on every new Sighting; never goes negative | *see below* |
| Reward | Aggregate Root | Allocation only after Report is Resolved; only Reporter can allocate (decision 30); can only be offered by a registered (non-anonymous) Reporter (decision 33); modeled as a Promessa de Recompensa (CC arts. 854-860) — revocable only before a qualifying HelpOffer exists, auto-split among simultaneous qualifiers by default (decision 30) | *see below* |
| UserIdentity | Aggregate Root | Role transitions: none→reporter/helper always allowed; →police only via validation (deferred) | *see below* |
| AccountabilityLogEntry | Aggregate Root (append-only) | Immutable once written; never exposed to end users | *see below* |
| UserAccount | Aggregate Root | Jurisdiction always `BR` in MVP (decision 24); consent required before registration completes | *see below* |

```ts
class Report {
  id: ReportId; category: Category | null; freeTag: FreeTag | null
  resolve(): void // throws if already Resolved
}
```
```ts
class HelpOffer {
  id: HelpOfferId; reportId: ReportId; helperRole: HelperRole
  accept(): void // throws if helper === report.reporterId
}
```
```ts
class DirectionEstimate {
  reportId: ReportId; probabilityByDirection: Map<Direction, number>
  applySighting(s: DirectionSighting): void // reweights per decision 26/27
}
```
```ts
class Reward {
  id: RewardId; reportId: ReportId; offer: RewardOffer
  allocate(claims: RewardClaim[]): void // throws if report not Resolved; auto-splits if claims.length > 1 (CC art. 860)
  revoke(): void // throws RewardAlreadyFulfilledError if any qualifying HelpOffer already exists (CC art. 856)
}
```

## Section 2 — Value Objects / Types / Interfaces

| Name | Context / Layer | Validation & Typing Rules | 4-line Snippet |
|---|---|---|---|
| ReportId | Report Management | Positive int, immutable | *see below* |
| Category | Report Management | One of the curated taxonomy (decision 9) or null | *see below* |
| FreeTag | Report Management | Non-empty string, max 50 chars, used only when Category is null | *see below* |
| DynamicRadius | Help Matching | Positive float (km); computed, never user-supplied | *see below* |
| HelpType | Help Matching | One of the fixed list from decision 10 | *see below* |
| Direction | Direction Sighting Aggregation | Compass point enum (N/S/E/W/NE/NW/SE/SW) | *see below* |
| SightingWeight | Direction Sighting Aggregation | Float 0–1; lower for anonymous helper (decision 27) | *see below* |
| RewardOffer | Reward & Incentives | Discriminated union: money \| perk \| reciprocity \| none (decision 1) | *see below* |
| Role | Identity & Trust | Enum: anonymous \| reporter \| helper \| police (decision 4) | *see below* |
| AnonymityMode | Identity & Trust | Enum: anonymous \| identified-no-reward \| identified-with-reward (decision 6) | *see below* |
| Jurisdiction | User Registration & Compliance | Fixed `BR` for MVP (decision 24) | *see below* |
| GeoPosition | Geolocation Primitives | Valid lat/lng pair | *see below* |
| LoginProvider | User Registration & Compliance | Enum: google \| apple \| facebook \| phone_otp *(phone_otp pending confirmation, decision 31)* | *see below* |

```ts
class Category {
  value: 'assault'|'environmental'|'robbery'|'homicide'|'illegal_commerce'|'missing_person'|'fugitive'|'suspicious'|'trafficking'|'traffic'|'vandalism'
}
```
```ts
type RewardOffer =
  | { kind: 'money'; amount: number; currency: 'BRL' }
  | { kind: 'perk'; description: string }
  | { kind: 'reciprocity' } | { kind: 'none' }
```
```ts
class SightingWeight {
  value: number // 0..1 — lower when Sighting.reporterRole === 'anonymous'
}
```
```ts
class AnonymityMode {
  value: 'anonymous'|'identified_no_reward'|'identified_with_reward'
}
```
```ts
class LoginProvider {
  value: 'google'|'apple'|'facebook'|'phone_otp' // frictionless-first, decision 31
}
```

## Section 3 — Domain Services / Use Cases

| Operation | Responsibility | Coordinates | 4-line Snippet |
|---|---|---|---|
| SubmitReport | Creates a Report with Category/FreeTag and initial location | Report, GeoPosition | *see below* |
| ResolveReport | Transitions Report to Resolved, notifies linked HelpOffers (decision 18) | Report, HelpOffer | *see below* |
| EditReport | Applies an edit, appends a timeline event, notifies linked HelpOffers (decision 19) | Report, ReportTimelineEvent | *see below* |
| CalculateDynamicRadius | Computes radius in km for a given Category (decision 7, 29) | Category | *see below* |
| ListNearbyReports | Paginated feed by proximity + recency/relevance (decision 21) | Report, DynamicRadius, GeoPosition | *see below* |
| SubmitHelpOffer | Registers a HelpOffer with chosen HelpType; rejects self-dealing (decision 20) | HelpOffer, Report | *see below* |
| LogDirectionSighting | Records a Sighting synchronously and triggers reweighting (decision 22) | DirectionSighting, DirectionEstimate | *see below* |
| ReconcileDirectionEstimate | Recomputes weighted probability across all Sightings (decision 26, 27) | DirectionEstimate, SightingWeight | *see below* |
| OfferReward | Attaches a RewardOffer to a Report; Reporter-only and requires the Reporter to be registered (decision 1, 30, 33) | Reward, Report (via ACL reference), UserIdentity | *see below* |
| AuthenticateWithProvider | Exchanges a Google/Apple/Facebook/phone-OTP credential for a session JWT (decision 31) | UserAccount, LoginProvider | *see below* |
| AllocateReward | Reporter allocates Reward among RewardClaims after Resolution (decision 30) | Reward, RewardClaim | *see below* |
| RegisterAnonymousActivity | Logs IP/metadata for an anonymous actor without exposing it (decision 23) | AccountabilityLogEntry | *see below* |
| CompleteRegistration | Registers a UserAccount, records consent, fixes Jurisdiction=BR (decision 8, 24) | UserAccount, ConsentRecord | *see below* |
| QueueOfflineSubmission | Persists a Report/Sighting draft for later dispatch (decision 28) | Report or DirectionSighting (deferred write) | *see below* |

```ts
function calculateDynamicRadius(category: Category): DynamicRadius {
  // per-category strategy table (decision 7) — lost pet grows, domestic violence stays small
}
```
```ts
function reconcileDirectionEstimate(estimate: DirectionEstimate, sighting: DirectionSighting): DirectionEstimate {
  // weight = SightingWeight(sighting.reporterRole); redistribute probabilityByDirection
}
```
```ts
function submitHelpOffer(reportId: ReportId, helperId: UserId, type: HelpType): HelpOffer {
  // throws SelfDealingError if helperId === report.reporterId (decision 20)
}
```
```ts
function allocateReward(reward: Reward, claims: RewardClaim[], reporterId: UserId): void {
  // throws UnauthorizedError if reporterId !== reward.reportRef.reporterId
}
```
```ts
function authenticateWithProvider(provider: LoginProvider, token: string): Promise<{ jwt: string }> {
  // verifies token with provider SDK, upserts UserAccount, issues session JWT (decision 31)
}
```

## Section 4 — Events / Messages / Async Flows

| Event | Trigger | Minimum Payload | Consumers |
|---|---|---|---|
| ReportSubmitted | SubmitReport succeeds | `{ reportId, category, position, submittedAt }` | HelpMatching (feed indexing) |
| ReportResolved | ResolveReport succeeds | `{ reportId, resolvedAt }` | HelpOffer (closure notice, decision 18) |
| ReportEdited | EditReport succeeds | `{ reportId, editedAt, changedFields }` | HelpOffer (edit notice, decision 19) |
| HelpOfferSubmitted | SubmitHelpOffer succeeds | `{ helpOfferId, reportId, helperId, helpType }` | ReportManagement (timeline) |
| DirectionSightingLogged | LogDirectionSighting succeeds | `{ reportId, direction, reporterRole, loggedAt }` | DirectionSightingAggregation (reweighting) |
| RewardOffered | OfferReward succeeds | `{ rewardId, reportId, offer }` | ReportManagement (timeline, opaque ref only) |
| RewardAllocated | AllocateReward succeeds | `{ rewardId, claimIds[] }` | none (terminal) |
| UserAuthenticated | AuthenticateWithProvider succeeds | `{ userId, provider, authenticatedAt }` | AccountabilityLog (audit trail) |

## Section 5 — Persistence / Repository Interfaces

| Resource | Methods | Return Types |
|---|---|---|
| ReportRepository | create, findById, update, listNearby(position, radius, page) | `Report`, `Report[]` |
| HelpOfferRepository | create, findByReportId, findByHelperId | `HelpOffer`, `HelpOffer[]` |
| DirectionEstimateRepository | findByReportId, save | `DirectionEstimate`, `void` |
| RewardRepository | create, findByReportId, save | `Reward`, `void` |
| UserIdentityRepository | findById, save | `UserIdentity`, `void` |
| AccountabilityLogRepository | append, findByActor *(internal-only, never exposed via API)* | `void`, `AccountabilityLogEntry[]` |
| UserAccountRepository | create, findById, findByEmail | `UserAccount` |

```ts
interface ReportRepository {
  create(input: ReportInput): Promise<Report>
  listNearby(pos: GeoPosition, radiusKm: number, page: number): Promise<Report[]>
}
```

## Section 6 — Ordered Development Tasks

```json
[
  { "id": "01", "title": "Implement Category and FreeTag value objects", "description": "Creates the two-axis taxonomy types used by every Report.", "scope": ["src/modules/reports/reports.interface.ts", "src/modules/reports/__tests__/category.spec.ts"], "acceptance": ["Rejects a Category outside the curated list", "Accepts a FreeTag only when Category is null"], "depends_on": null },
  { "id": "02", "title": "Implement Report aggregate", "description": "Creates the Report entity with timeline and Resolve/Edit transitions.", "scope": ["src/modules/reports/reports.service.ts"], "acceptance": ["resolve() throws if already Resolved", "edit() appends a ReportTimelineEvent"], "depends_on": "01" },
  { "id": "03", "title": "Implement ReportRepository and reports module routes", "description": "Wires SQL persistence and HTTP endpoints for Report CRUD.", "scope": ["src/modules/reports/reports.repository.ts", "src/modules/reports/reports.controller.ts", "src/modules/reports/reports.routes.ts", "src/migrations/sql/001_reports.sql"], "acceptance": ["POST /api/reports creates and returns 201", "GET /api/reports/:id returns 404 for missing id"], "depends_on": "02" },
  { "id": "04", "title": "Implement CalculateDynamicRadius domain service", "description": "Computes the per-Category search radius used by the nearby feed.", "scope": ["src/modules/help-matching/dynamic-radius.service.ts", "src/modules/help-matching/__tests__/dynamic-radius.spec.ts"], "acceptance": ["Returns a larger, growing radius for lost-pet categories", "Returns a small fixed radius for domestic-violence categories"], "depends_on": "01" },
  { "id": "05", "title": "Implement ListNearbyReports with pagination", "description": "Builds the paginated, recency/relevance-ordered NearbyReportsFeed.", "scope": ["src/modules/help-matching/help-matching.service.ts", "src/modules/help-matching/help-matching.repository.ts"], "acceptance": ["Returns paginated results within the Dynamic Radius", "Supports both recency and relevance ordering"], "depends_on": "04" },
  { "id": "06", "title": "Implement HelpOffer aggregate with self-dealing guard", "description": "Creates HelpOffer with HelpType selection, rejecting Reporter self-candidacy.", "scope": ["src/modules/help-offers/help-offers.service.ts", "src/modules/help-offers/__tests__/help-offers.spec.ts"], "acceptance": ["Throws SelfDealingError when helperId equals the Report's reporterId", "Accepts any HelpType from the fixed list"], "depends_on": "03" },
  { "id": "07", "title": "Implement HelpOfferRepository and help-offers module routes", "description": "Wires SQL persistence and HTTP endpoints for Help Offers.", "scope": ["src/modules/help-offers/help-offers.repository.ts", "src/modules/help-offers/help-offers.controller.ts", "src/modules/help-offers/help-offers.routes.ts", "src/migrations/sql/002_help_offers.sql"], "acceptance": ["POST /api/help-offers creates and returns 201", "Report resolution notice reaches all linked HelpOffers (decision 18)"], "depends_on": "06" },
  { "id": "08", "title": "Implement Direction, SightingWeight value objects", "description": "Creates the typed direction enum and identity-weighted sighting scalar.", "scope": ["src/modules/direction-sightings/direction-sightings.interface.ts"], "acceptance": ["SightingWeight is lower for anonymous role than identified role"], "depends_on": null },
  { "id": "09", "title": "Implement DirectionEstimate aggregate and reconciliation algorithm", "description": "Implements the weighted statistical reconciliation across Sightings.", "scope": ["src/modules/direction-sightings/direction-sightings.service.ts", "src/modules/direction-sightings/__tests__/reconciliation.spec.ts"], "acceptance": ["Starts at 50/50 prior between two conflicting directions", "Shifts probability as additional weighted Sightings arrive"], "depends_on": "08" },
  { "id": "10", "title": "Implement LogDirectionSighting synchronous endpoint", "description": "Wires the synchronous ingestion path required by decision 22.", "scope": ["src/modules/direction-sightings/direction-sightings.repository.ts", "src/modules/direction-sightings/direction-sightings.controller.ts", "src/modules/direction-sightings/direction-sightings.routes.ts", "src/migrations/sql/003_direction_sightings.sql"], "acceptance": ["POST responds only after reconciliation completes (no async queue)"], "depends_on": "09" },
  { "id": "11", "title": "Implement Role, AnonymityMode value objects and UserIdentity aggregate", "description": "Creates the layered identity/anonymity model.", "scope": ["src/modules/identity/identity.interface.ts", "src/modules/identity/identity.service.ts"], "acceptance": ["identified_with_reward requires a completed UserAccount registration", "Role transition to 'police' is rejected outright (deferred, decision 12)"], "depends_on": null },
  { "id": "12", "title": "Implement AccountabilityLogEntry append-only log", "description": "Captures IP/metadata for anonymous actors, never exposed via any API response.", "scope": ["src/modules/identity/accountability-log.repository.ts", "src/migrations/sql/004_accountability_log.sql"], "acceptance": ["Entry is written on every anonymous Report/HelpOffer submission", "No controller or DTO ever serializes this table's contents"], "depends_on": "11" },
  { "id": "13", "title": "Implement UserAccount registration with fixed BR jurisdiction", "description": "Registration flow recording consent and defaulting Jurisdiction to BR.", "scope": ["src/modules/accounts/accounts.service.ts", "src/modules/accounts/accounts.repository.ts", "src/modules/accounts/accounts.controller.ts", "src/modules/accounts/accounts.routes.ts", "src/migrations/sql/005_user_accounts.sql"], "acceptance": ["Registration fails without recorded consent", "Jurisdiction is always BR regardless of submitted location"], "depends_on": "11" },
  { "id": "14", "title": "Implement RewardOffer value object and Reward aggregate behind an ACL", "description": "Creates the Reporter-only reward model with an opaque Report reference.", "scope": ["src/modules/rewards/rewards.interface.ts", "src/modules/rewards/rewards.service.ts", "src/modules/rewards/__tests__/reward-acl.spec.ts"], "acceptance": ["Reward never reads Report.category or Report.tags directly", "AllocateReward throws UnauthorizedError for a non-Reporter caller", "OfferReward throws UnregisteredReporterError when the Reporter's AnonymityMode is anonymous (decision 33)"], "depends_on": "07" },
  { "id": "15", "title": "Implement RewardRepository and rewards module routes", "description": "Wires SQL persistence and HTTP endpoints for Reward offer/allocation.", "scope": ["src/modules/rewards/rewards.repository.ts", "src/modules/rewards/rewards.controller.ts", "src/modules/rewards/rewards.routes.ts", "src/migrations/sql/006_rewards.sql"], "acceptance": ["AllocateReward rejects allocation before Report is Resolved"], "depends_on": "14" },
  { "id": "16", "title": "Wire authMiddleware role claims to Role/AnonymityMode", "description": "Connects the JWT payload shape to the Identity & Trust role model.", "scope": ["src/gateway/auth.middleware.ts", "src/shared/types/express.d.ts"], "acceptance": ["Anonymous routes skip authMiddleware entirely", "Identified routes populate req.user.role from the Identity aggregate"], "depends_on": "11" },
  { "id": "17", "title": "Implement LoginProvider value object and AuthenticateWithProvider use case", "description": "Verifies a Google/Apple/Facebook credential and issues a session JWT, upserting the UserAccount (decision 31).", "scope": ["src/modules/auth/auth.interface.ts", "src/modules/auth/auth.service.ts", "src/modules/auth/__tests__/auth.spec.ts"], "acceptance": ["Rejects a token that fails provider verification", "Upserts UserAccount on first login without duplicating an existing one on repeat login"], "depends_on": "13" },
  { "id": "18", "title": "Implement /auth/login route for Google, Apple, and Facebook", "description": "Wires the public authentication endpoint (no JWT required to call it) for the three confirmed providers.", "scope": ["src/modules/auth/auth.repository.ts", "src/modules/auth/auth.controller.ts", "src/modules/auth/auth.routes.ts", "src/migrations/sql/007_user_accounts_login_provider.sql"], "acceptance": ["POST /auth/login returns 200 with a JWT for a valid Google/Apple/Facebook token", "Returns 401 for an invalid or expired provider token"], "depends_on": "17" },
  { "id": "19", "title": "Implement phone/WhatsApp OTP login", "description": "Adds the 4th confirmed login method (decision 31) alongside Google/Apple/Facebook.", "scope": ["src/modules/auth/auth.service.ts", "src/modules/auth/auth.routes.ts", "src/modules/auth/__tests__/otp.spec.ts"], "acceptance": ["POST /auth/login/otp/request sends a code and POST /auth/login/otp/verify returns a JWT for a valid code", "Rejects an expired or already-used OTP code"], "depends_on": "18" },
  { "id": "20", "title": "Implement Reward revocation and auto-split allocation (CC arts. 854-860)", "description": "Adds revoke() blocked after a qualifying HelpOffer exists, and default auto-split when multiple Helpers qualify simultaneously (decision 30).", "scope": ["src/modules/rewards/rewards.service.ts", "src/modules/rewards/__tests__/reward-promessa.spec.ts"], "acceptance": ["revoke() throws RewardAlreadyFulfilledError once any qualifying HelpOffer exists", "allocate() splits the reward evenly across all RewardClaims when the Reporter submits more than one claimId without a custom split"], "depends_on": "15" },
  { "id": "21", "title": "Implement 90-day auto-deletion for Child-tagged Report data", "description": "Schedules deletion of Report data (photos, fields) 90 days after resolution when SubjectTag=Child (decision 25).", "scope": ["src/modules/reports/reports.service.ts", "src/migrations/sql/008_report_retention_job.sql"], "acceptance": ["A Child-tagged Report's sensitive data is purged 90 days after ReportResolved, verified by a scheduled job test with a mocked clock", "Non-Child-tagged Reports are unaffected by this job"], "depends_on": "03" }
]
```

## Save

Saved to: `D:\ProjetoVGR\api\docs\specs\vgr\003-api-tactical-design.md`
