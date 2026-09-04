# Tactical Design — api
**Domain:** vgr | **Project:** api

> Backend architecture: Express/TypeScript module pattern (`interface → dto → repository → service → controller → routes`), per `docs/adr/ARCHITECTURE.md`. DDD constructs (Aggregates, VOs) map onto `<m>.interface.ts`/`<m>.service.ts`; they do not replace the module pattern.

> **Amended — Report front R1 (decisions 134-142, `plano-denuncia.md`).**
> This design predates the Legal Gate (76+), the two auth planes (119),
> media (126-132) and the zero-friction principle (123). Amendments over
> tasks 01-07/21/24/25, applied as they are implemented:
> - **E1 (planes)**: tasks 03/07 say `POST /api/reports`; `/api` became
>   the PANEL plane (119). App routes mount at **/app-reports** (pattern
>   of /app-auth, /app-media); only admin/moderation routes live in /api.
> - **E2 (taxonomy, decision 140)**: Report carries TWO mandatory axes —
>   `category | freeTag` (XOR, decision 9) × `subject` (object/subject of
>   decision 3, with a one-tap `other` fallback protecting decision 123).
>   The spec's `SubjectTag=Child` special case becomes `subject='child'`.
> - **E3 (Legal Gate)**: anonymous submission consumes the
>   `report.anonymous` capability (assertCapability; removed from
>   PENDING_WIRING when wired — the catalog partition test enforces it).
> - **E4 (media, decisions 126-132)**: reports reference `tb_media`
>   (attach flow, timeline event, MEDIA_MAX_PER_REPORT, blur derivative
>   for critical tiers, `expires_at` stamped at resolution).
> - **E5 (retention)**: task 21's dedicated SQL job is superseded by the
>   scheduler (decision 90) + crypto-shredding (131); Child purge (25) is
>   one more rule of the existing expiry job.
> - **E6 (idempotency, decision 137)**: SubmitReport takes a client-
>   generated UUID (`clientKey`, unique column); an offline-queue replay
>   (decision 28) returns the SAME report with 200, never a duplicate.
> - **E7 (identity)**: `reporterId` is `tb_user_account.id` (app plane) or
>   NULL for anonymous; a logged-in reporter may still CHOOSE anonymity
>   (decision 32) — the account is then kept internally only
>   (accountability, decision 23), never exposed. Tasks 16-19's /auth
>   provider flow was superseded by the implemented decisions 119-124.
> - **E8 (numbering)**: migration filenames in tasks (`001_reports.sql`…)
>   are stale; current sequence applies (030+). Cross-module reads forced
>   by SubmitReport (category-form validation, accountability append) are
>   promoted to `shared/` — the promotion tasks 24/32 already flagged.

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
| RiskTierConfig | Aggregate Root (Admin Configuration) | One row per Category; admin-editable at runtime, cached with TTL (mirrors `tb_feature_flag`, decision 46) | *see below* |
| CategoryFormSchema | Aggregate Root (Admin Configuration) | Admin-editable per-Category field schema (decision 47); never hardcoded per category | *see below* |
| HelperRating | Aggregate Root (Identity & Trust) | Accumulates on Helper's internal identity; never exposes raw identity to the rater (decision 48). **Implemented 2026-09-03 — see `docs/feature/rating.md`**: lives in `src/modules/ratings/` (not `identity`, which has no router by design); one row per help OFFER (`tb_helper_rating`, UNIQUE on the offer and on the clientKey, migration 045); only a helper WITH an account is ratable (180), even when anonymous to the reporter; rated only once the case is resolved (181); immutable (183); survives the purge and leaves the aggregate while the case is hidden (187); app-plane routes `POST /app-reports/:reportId/offers/:offerId/rating` and `GET /app-ratings/me` | *see below* |
| PanicAlert | Aggregate Root (Panic Alert) | Must resolve to ≥1 recipient (pool and/or personal contact) before being considered sent (decisions 63-65). **Implemented 2026-09-04 — see `docs/feature/panic.md`**: PP1 revises this to "created regardless of recipient count" — `trigger()` never refuses for an empty pool (65's "the click is never blocked waiting on configuration", plan success criterion 2); single shot only (191, no live/streaming session); `tb_panic_alert` (migration 046), `client_key` idempotent AND the anonymous bearer secret (134/137 pattern); routes `POST /app-panic/alert`, `GET /app-panic/alerts`, `POST /app-panic/alerts/:id/resolve` | *see below* |
| ResponderPoolMembership | Aggregate Root (Panic Alert) | Only created via admin approval; criteria still pending (decision 52). **Implemented 2026-09-04**: decision 190 CLOSES 52 — no codified eligibility rule, free human judgment by an admin, exactly as the pre-existing `criteria_notes` free text already modeled; nothing new built for the criterion itself. Plane fix (not a new decision): `POST` (the mobile user's own join request) moved from the admin-only `/api/panic/responder-pool` to `POST /app-panic/responder-pool` under `appAuthMiddleware` (required) — it read `req.user!.userId` (an admin's id) before, unreachable by a real mobile user; now reads `req.appAccountId!`. `GET`/`PUT :id/resolve` stay admin-gated under `/api`, unchanged | *see below* |
| ChatThread | Aggregate Root (Messaging) | Exists only in the context of one Report + one HelperId pair; masks identity per RiskTierConfig (decisions 54, 60). **Implemented 2026-09-03 — see `docs/feature/chat.md`**: the helper must hold an ACCOUNT (169); the thread is keyed by (report, helperAccount) — UNIQUE in `tb_chat_thread`; find-or-create on the helper's first message (173); routes at `/app-chat/...` (app plane, amendment E1), never `/api/chat` | *see below* |
| PaymentIntent | Aggregate Root (Payment Intermediation) | Mode `intermediated` \| `peer_to_peer`; `peer_to_peer` rejected outright when RiskTierConfig marks the Report high-risk (decision 58) | *see below* |
| DualControlAccessRequest | Aggregate Root (Admin Configuration) | Requires 2 distinct admin approvals + a logged legal basis before granting decryption (decision 45) | *see below* |
| FeeRule | Aggregate Root (Admin Configuration) | Amendment (task 32) — `003-admin-tactical-design.md` specifies `FeeRuleEntity`/`FeeRuleRepository` (admin task 07) but no API-side task or repository ever existed for it; category nullable = global default, admin-editable, cached with TTL (mirrors `RiskTierConfig`, decisions 39/58) | *see below* |
| AdminAccount | Aggregate Root (Admin Authentication) | Amendment (task 33, decision 67) — email + bcrypt password hash; no self-registration, only seeded/created manually; issues the same JWT shape (`{userId, role}`) as every other authenticated route | *see below* |

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
```ts
class RiskTierConfig {
  category: Category; tier: 'low' | 'medium' | 'high'
  // 'high' forces: mandatory anonymity toward other users, hidden real-time engagement, intermediated-only payment
}
```
```ts
class PanicAlert {
  id: PanicAlertId; triggeredBy: UserId; recipients: AlertRecipient[]
  trigger(): void // throws NoRecipientConfiguredError if recipients.length === 0 after defaulting to the responder pool
}
// Amended 2026-09-04 (PP1): trigger() does NOT throw on an empty recipient set — decision 65's spirit and the
// plan's success criterion 2 read "never refuse for an empty pool" as binding; panic-alert.service.ts triggerAlert()
// inserts tb_panic_alert regardless, then tb_panic_alert_recipient with however many rows the snapshot yields
// (zero included). triggeredBy is UserId | null (an anonymous clientKey trigger has no UserId, 134/137 pattern).
// recipients this round are responder_pool members ONLY (193 defers trusted_contact) — see AlertRecipient below.
```
```ts
class ChatThread {
  id: ChatThreadId; reportId: ReportId; participantMask: Map<UserId, MaskedIdentity>
  postMessage(from: UserId, text: string): ChatMessage // resolves `from` through participantMask before persisting
}
// Amended 2026-09-03 (C1): participantMask = tb_chat_participant rows (role reporter|helper, token = 32 hex from
// randomBytes(16)); the reporter may be anonymous (client_key of the report, decisions 134/137). postMessage is
// chat.service post(): replay by clientKey (172) -> closed 409 (173) -> text/contact 422 (171) -> gate chat.masked 451
// (176) -> DB-counted rate 429 (177) -> append + accountability for the anonymous reporter (23).
```
```ts
class PaymentIntent {
  id: PaymentIntentId; rewardId: RewardId; mode: 'intermediated' | 'peer_to_peer'
  confirm(): void // throws PeerToPeerNotAllowedError if mode==='peer_to_peer' and RiskTierConfig.tier==='high'
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
| Role | Identity & Trust | Enum: anonymous \| reporter \| helper \| police \| admin — `admin` amended in: decision 4 only covered citizen-facing roles, but decision 56 (admin panel) and every admin-config task (22, 27, 31...) require a platform-administrator role that was never reconciled into this enum until now | *see below* |
| AnonymityMode | Identity & Trust | Enum: anonymous \| identified-no-reward \| identified-with-reward (decision 6) | *see below* |
| Jurisdiction | User Registration & Compliance | Fixed `BR` for MVP (decision 24) | *see below* |
| GeoPosition | Geolocation Primitives | Valid lat/lng pair | *see below* |
| LoginProvider | User Registration & Compliance | Enum: google \| apple \| facebook \| phone_otp — all four confirmed (decision 31) | *see below* |
| RiskTier | Admin Configuration | Enum: low \| medium \| high; sourced from RiskTierConfig, never hardcoded (decision 46) | *see below* |
| HelpTypeFieldSchema | Admin Configuration | JSON schema per Category (decision 47); validated server-side before accepting a Report's detail fields | *see below* |
| RatingScore | Identity & Trust | Int 1–5; attaches to HelperRating, never to a public-facing Helper profile. **Implemented 2026-09-03** as `tb_helper_rating.score TINYINT` CHECK 1..5 + `rateHelperDto` (`z.number().int().min(1).max(5)`), no text (182); served only to the owner who gave it (`offers[].rating.score`) and to the helper as an aggregate average under the k = 5 floor (184/185) | *see below* |
| AlertRecipient | Panic Alert | Discriminated union: responder_pool \| trusted_contact (decision 64). **Implemented 2026-09-04**: PP1 builds ONLY the `responder_pool` member — decision 193 explicitly defers `trusted_contact` to a future round, so no union type exists in code; a recipient is simply a `tb_panic_alert_recipient` row snapshotting one `tb_user_account.id` from `findActiveResponders()` at trigger time | *see below* |
| PaymentMode | Payment Intermediation | Enum: intermediated \| peer_to_peer; `peer_to_peer` invalid when RiskTier=high (decision 58) | *see below* |
| MaskedIdentity | Messaging | Opaque per-thread token; never resolves back to UserId outside Identity & Trust (decision 54, 55). **Implemented 2026-09-03** as `tb_chat_participant.token` (UNIQUE), served as `participantToken`; `displayName` follows the offer's mask (170) | *see below* |

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
class Role {
  value: 'anonymous'|'reporter'|'helper'|'police'|'admin'
  // 'admin' never participates in AnonymityMode/Report flows — gates admin-config endpoints only
}
```
```ts
class LoginProvider {
  value: 'google'|'apple'|'facebook'|'phone_otp' // frictionless-first, decision 31
}
```
```ts
class RiskTier {
  value: 'low'|'medium'|'high' // resolved from RiskTierConfig at read time, never cached in Report itself
}
```
```ts
class MaskedIdentity {
  token: string // opaque per-(ChatThread,UserId) pair; regenerated per thread, never reused across Reports
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
| ConfigureRiskTier | Admin sets/updates the RiskTier for a Category (decision 46) | RiskTierConfig | *see below* |
| ConfigureCategoryFormSchema | Admin sets/updates the detail-field schema for a Category (decision 47) | CategoryFormSchema | *see below* |
| GetReportVisibility | Restricts a Resolved Report's detail/timeline/ratings to participants only (decision 50) | Report, HelpOffer | *see below* |
| RateHelper | Reporter rates a Helper at Report finalization (decision 48). **Implemented 2026-09-03** as `ratings/helper-rating.service.ts rateHelper`: owner (account or `x-client-key`) → offer of this report → replay by clientKey (137) / 409 `ALREADY_RATED` (183) → 409 `RATING_CLOSED` open|hidden (181/162) → 422 `RATING_NOT_ALLOWED` no account (180) → gate `helper.rating` 451 (188) → insert → accountability for the anonymous owner (23) | HelperRating, UserIdentity | *see below* |
| RequestResponderAuthorization | User applies to join the Authorized Responder pool. **Implemented 2026-09-04** as `responder-pool.service.ts requestResponderAuthorization`, called from `POST /app-panic/responder-pool` (`appAuthMiddleware`, required) — plane fix, see ResponderPoolMembership above | ResponderPoolMembership | *see below* |
| ApproveResponderAuthorization | Admin approves/denies a pool application (decision 52 — criteria pending). **Implemented 2026-09-04**: decision 190 closes 52 (no codified rule); unchanged `PUT /api/panic/responder-pool/:id/resolve`, admin-gated | ResponderPoolMembership | *see below* |
| TriggerPanicAlert | Fires an alert to the configured or default recipients, with continuous geolocation (decisions 62-65). **Implemented 2026-09-04** as `panic-alert.service.ts triggerAlert`: idempotent by clientKey (137) → cooldown 409 `PANIC_ALERT_ACTIVE` for an identified caller only (198) → gate `panic.dispatch` 451 (51) → snapshot `findActiveResponders()` (never refuses an empty pool, 65) → insert alert + recipients → accountability for an anonymous triggerer (23); single shot, not continuous (191) — see `POST /app-panic/alert` | PanicAlert, AlertRecipient, GeoPosition | *see below* |
| PostChatMessage | Sends a masked message on a Report's ChatThread (decision 54) | ChatThread, MaskedIdentity | *see below* |
| ProcessRewardPayment | Routes an allocated Reward through the PSP (intermediated) or clears it for direct settlement (peer-to-peer), enforcing decision 58's RiskTier constraint | PaymentIntent, Reward, RiskTierConfig | *see below* |
| RequestDualControlAccess | Requests decryption of AccountabilityLogEntry data, requiring legal basis + 2 admin approvals (decision 45) | DualControlAccessRequest, AccountabilityLogEntry | *see below* |

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
```ts
function getReportVisibility(report: Report, viewerId: UserId): ReportView {
  // full view (timeline, ratings) only if viewerId has a HelpOffer on report; else summary-only (decision 50)
}
```
```ts
function triggerPanicAlert(userId: UserId, config?: AlertRecipient[]): PanicAlert {
  // config ?? [defaultResponderPool()] — never resolves to zero recipients (decision 63-65)
}
// Amended 2026-09-04 (PP1): userId is UserId | null — an anonymous trigger has no account, only a fresh
// clientKey (134/137 pattern); there is no `config` parameter this round — trusted_contact (64) is deferred
// (193), so the ONLY source is defaultResponderPool() (findActiveResponders()), always. "never resolves to
// zero recipients" is REVISED: the ALERT is never refused for an empty pool (65), but recipients[] MAY be
// empty — panic-alert.service.ts triggerAlert(input: TriggerPanicAlertInput, actor: PanicAlertActor).
```
```ts
function processRewardPayment(intent: PaymentIntent, tier: RiskTier): void {
  // throws PeerToPeerNotAllowedError if intent.mode==='peer_to_peer' && tier==='high' (decision 58)
}
```
```ts
function requestDualControlAccess(req: DualControlAccessRequest): void {
  // throws InsufficientApprovalError unless 2 distinct adminIds + a legalBasis are recorded (decision 45)
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
| RiskTierConfigured | ConfigureRiskTier succeeds | `{ category, tier, configuredBy }` | ReportManagement, HelpMatching, Reward (cache invalidation) |
| HelperRated | RateHelper succeeds | `{ ratingId, reportId, helperInternalId, score }` | Identity & Trust (reputation accumulation). **Implemented 2026-09-03**: no event bus — the row IS the accumulation (`aggregateByHelperInternalId`); the HTTP answer is this payload plus `helpOfferId`/`createdAt` and MINUS `helperInternalId`, which never leaves the API (48/60) |
| ResponderPoolMembershipApproved | ApproveResponderAuthorization succeeds | `{ userId, approvedBy, approvedAt }` | PanicAlert (recipient pool) |
| PanicAlertTriggered | TriggerPanicAlert succeeds | `{ alertId, triggeredBy, recipients[], position }` | Notification delivery (out of MVP scope beyond in-app). **Implemented 2026-09-04**: no event bus — the row IS the notification surface: `tb_panic_alert_recipient` is the trigger-time snapshot of `recipients[]`, read back by `GET /app-panic/alerts` (cursor polling, 192, no push/SSE/websocket); the HTTP trigger answer is `{ alertId, createdAt, recipientCount }` — `recipients[]` and raw `position` never leave the API (platform-wide identity/position minimization) |
| ChatMessagePosted | PostChatMessage succeeds | `{ threadId, maskedSenderToken, sentAt }` | ChatThread participants |
| PaymentIntentConfirmed | ProcessRewardPayment succeeds | `{ intentId, rewardId, mode, feeRetained? }` | Reward (marks payout complete) |
| DualControlAccessGranted | RequestDualControlAccess succeeds | `{ requestId, approverIds[], legalBasis }` | AccountabilityLog (audit trail, permanent) |

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
| RiskTierConfigRepository | findByCategory (TTL-cached), upsert | `RiskTierConfig`, `void` |
| CategoryFormSchemaRepository | findByCategory, upsert | `CategoryFormSchema`, `void` |
| HelperRatingRepository | create, findByHelperInternalId — **implemented 2026-09-03** as `ratings/helper-rating.repository` `insertRating` (null on the UNIQUE race — offer or clientKey — the service re-reads the winner) and `aggregateByHelperInternalId` (COUNT/AVG in SQL, hidden cases excluded by the JOIN — 187/189; the rows are never listed: no consumer yet, 189), plus `findRatingByOffer` | `HelperRating`, `{ count, average }` |
| ResponderPoolRepository | requestMembership, approve, findActiveMembers | `ResponderPoolMembership` |
| PanicAlertRepository | create, findById — **implemented 2026-09-04** as `panic-alert.repository` `findAlertByClientKey` (idempotency, 137), `findActiveAlertByAccount` (cooldown, 198), `findAlertById`, `insertAlert` (insert-then-read-back), `insertRecipients` (bulk snapshot, no-op on an empty array), `countRecipients`, `resolveAlert` (atomic `active` -> `resolved`, 197), plus `findAlertsForResponder` (the inbox JOIN, cursor by alert id, 192) | `PanicAlert`, `PanicAlertRow[]` |
| ChatThreadRepository | findOrCreateByReportAndHelper, appendMessage — **implemented 2026-09-03** as `chat.repository` `findThreadByReportAndHelper` + `insertThreadWithParticipants` (null on the UNIQUE race) and `insertMessage` (null on the clientKey race), plus `listThreadsByReport` / `listMessages` for C3 | `ChatThread`, `ChatMessage` |
| PaymentIntentRepository | create, findByRewardId, markConfirmed | `PaymentIntent`, `void` |
| DualControlAccessRepository | create, addApproval, findPending *(internal-only)* | `DualControlAccessRequest` |
| FeeRuleRepository | findByCategory (TTL-cached, falls back to the global/`null`-category rule), upsert, findAll | `FeeRule`, `void`, `FeeRule[]` |
| AdminAccountRepository | findByEmail | `AdminAccount` |

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
  { "id": "21", "title": "Implement 90-day auto-deletion for Child-tagged Report data", "description": "Schedules deletion of Report data (photos, fields) 90 days after resolution when SubjectTag=Child (decision 25).", "scope": ["src/modules/reports/reports.service.ts", "src/migrations/sql/008_report_retention_job.sql"], "acceptance": ["A Child-tagged Report's sensitive data is purged 90 days after ReportResolved, verified by a scheduled job test with a mocked clock", "Non-Child-tagged Reports are unaffected by this job"], "depends_on": "03" },
  { "id": "22", "title": "Implement RiskTierConfig registry (admin-managed, TTL-cached)", "description": "Creates the runtime-editable RiskTier-per-Category registry mirroring the tb_feature_flag pattern (decision 46).", "scope": ["src/modules/risk-config/risk-config.interface.ts", "src/modules/risk-config/risk-config.service.ts", "src/modules/risk-config/risk-config.repository.ts", "src/migrations/sql/009_risk_tier_config.sql"], "acceptance": ["Admin can set a Category's tier without a code deploy", "Read path uses the TTL cache, not a query per request"], "depends_on": "01" },
  { "id": "23", "title": "Implement CategoryFormSchema registry", "description": "Creates the admin-editable per-Category detail-field schema (decision 47).", "scope": ["src/modules/risk-config/category-form-schema.service.ts", "src/migrations/sql/010_category_form_schema.sql"], "acceptance": ["SubmitReport validates detail fields against the Category's current schema", "Adding a new Category's schema requires no code change"], "depends_on": "22" },
  { "id": "24", "title": "Enforce RiskTier-driven mandatory anonymity and hidden engagement on Report reads", "description": "High-tier Reports hide real-time HelpOffer counts/timestamps from the Reporter and force AnonymityMode for Helpers (decisions 40, 41, 60).", "scope": ["src/modules/reports/reports.service.ts", "src/modules/help-offers/help-offers.service.ts", "src/modules/help-offers/__tests__/high-risk-anonymity.spec.ts"], "acceptance": ["High-tier Report responses never include per-HelpOffer timestamps to the Reporter", "Helper identity stays resolvable only internally (decision 60), never in the Reporter-facing payload"], "depends_on": "22" },
  { "id": "25", "title": "Implement GetReportVisibility (post-closure access restriction)", "description": "Restricts a Resolved Report's timeline/ratings to participants only (decision 50).", "scope": ["src/modules/reports/report-visibility.service.ts", "src/modules/reports/__tests__/visibility.spec.ts"], "acceptance": ["A user with no HelpOffer on a Resolved Report receives only the closure status", "A linked Helper still sees full timeline and ratings after resolution (decision 18)"], "depends_on": "07" },
  { "id": "26", "title": "Implement HelperRating aggregate and RateHelper use case", "description": "Lets the Reporter rate Helpers at finalization; rating accumulates on the Helper's internal identity (decision 48). Amended 2026-09-03: DONE as RT1 (decisions 178-189) — files are src/modules/ratings/helper-rating.{interface,dto,repository,service,controller,routes}.ts (modules/identity has no router by design, so the aggregate got its own module), migration 045_helper_rating.sql (011 was long taken); see docs/feature/rating.md.", "scope": ["src/modules/ratings/helper-rating.service.ts", "src/modules/ratings/helper-rating.repository.ts", "src/modules/ratings/__tests__/helper-rating.service.spec.ts", "src/migrations/sql/045_helper_rating.sql"], "acceptance": ["Rating persists against the Helper's internal id even when the Helper was anonymous to the Reporter", "Reporter cannot rate the same HelpOffer twice"], "depends_on": "07" },
  { "id": "27", "title": "Implement ResponderPoolMembership request/approval workflow", "description": "Lets a user request Authorized Responder status; admin approves (criteria pending, decision 52). Amended 2026-09-04 (PP1): decision 190 CLOSES 52 with no codified rule (free admin judgment, unchanged criteria_notes free text); plane fix moved POST off the admin-only /api router to POST /app-panic/responder-pool under appAuthMiddleware — see docs/feature/panic.md.", "scope": ["src/modules/panic/responder-pool.service.ts", "src/modules/panic/responder-pool.repository.ts", "src/modules/panic/responder-pool-app.routes.ts", "src/migrations/sql/012_responder_pool.sql"], "acceptance": ["Request defaults to pending until an admin explicitly approves", "Approved members are queryable for panic-alert routing"], "depends_on": "11" },
  { "id": "28", "title": "Implement PanicAlert aggregate and TriggerPanicAlert use case", "description": "Fires an alert with continuous geolocation to the configured or default recipients (decisions 62-65). Amended 2026-09-04: DONE as PP1 (decisions 190-199) — files are src/modules/panic/panic-alert.{interface,dto,repository,service,controller,routes}.ts, migration 046_panic_alert.sql (013 was long taken); 'continuous geolocation' is REVISED to a single shot (191, no live session); trusted_contact recipient (64) and the activated/highlighted mode (63) are OUT of this round (193/194); see docs/feature/panic.md.", "scope": ["src/modules/panic/panic-alert.service.ts", "src/modules/panic/panic-alert.repository.ts", "src/modules/panic/__tests__/panic-alert.service.spec.ts", "src/migrations/sql/046_panic_alert.sql"], "acceptance": ["Trigger with no prior configuration routes to the Responder pool by default (decision 65)", "Trigger with a configured personal contact and/or pool routes to all configured recipients", "Never resolves to zero recipients"], "depends_on": "27" },
  { "id": "29", "title": "Implement ChatThread and masked messaging", "description": "One thread per Report+Helper pair, masking identity per RiskTierConfig (decision 54, 60). Amended 2026-09-03: DONE as C1 — files are src/modules/messaging/chat.{interface,dto,repository,service,controller,routes}.ts, shared/chat/contact-filter.ts, migration 043_chat.sql; see docs/feature/chat.md.", "scope": ["src/modules/messaging/chat.service.ts", "src/modules/messaging/chat.repository.ts", "src/modules/messaging/__tests__/chat.service.spec.ts", "src/migrations/sql/043_chat.sql"], "acceptance": ["Message payload never carries a raw UserId, only MaskedIdentity", "High-tier Reports mask identity from other Helpers too, not just the Reporter (decision 55)"], "depends_on": "24" },
  { "id": "30", "title": "Implement PaymentIntent with RiskTier-gated peer-to-peer/intermediated split", "description": "Routes an allocated Reward through the PSP or clears it for direct settlement, enforcing decision 58.", "scope": ["src/modules/payments/payment-intent.service.ts", "src/modules/payments/payment-intent.repository.ts", "src/modules/payments/__tests__/payment-mode.spec.ts", "src/migrations/sql/015_payment_intent.sql"], "acceptance": ["peer_to_peer mode is rejected outright when RiskTierConfig marks the Report high-tier", "PSP integration point is stubbed behind an interface pending vendor selection (decision 59)"], "depends_on": "20" },
  { "id": "31", "title": "Implement DualControlAccessRequest workflow for AccountabilityLogEntry decryption", "description": "Requires a logged legal basis and 2 distinct admin approvals before granting decryption (decision 45).", "scope": ["src/modules/admin-access/dual-control.service.ts", "src/modules/admin-access/dual-control.repository.ts", "src/modules/admin-access/__tests__/dual-control.spec.ts", "src/migrations/sql/016_dual_control_access.sql"], "acceptance": ["Access is denied with only 1 approval, even with a valid legal basis", "Every grant and denial is permanently logged, including the two approver identities"], "depends_on": "12" },
  { "id": "32", "title": "Implement FeeRule registry (admin-managed, TTL-cached, nullable category = global default)", "description": "Creates the runtime-editable fee-percent + allowed-payment-mode registry, mirroring RiskTierConfig's pattern (decisions 39, 58).", "scope": ["src/modules/monetization-config/fee-rule.interface.ts", "src/modules/monetization-config/fee-rule.service.ts", "src/modules/monetization-config/fee-rule.repository.ts", "src/migrations/sql/017_fee_rule.sql"], "acceptance": ["Admin can set a Category's feePercent/paymentModeAllowed without a code deploy", "A Category with no specific rule falls back to the global default rule, not a hardcoded value"], "depends_on": "22", "note": "Amendment — this task never existed in the original backlog even though `003-admin-tactical-design.md`'s task 07 (`FeeRuleEntity`/`FeeRuleRepository`) and decisions 39/58 both require an API-side counterpart. Added when admin task 07 was about to be started and had nothing to call. The 'high-tier categories cannot allow peer_to_peer' constraint (mirrors task 30's PaymentIntent check) is NOT enforced here — it would require this module to read RiskTierConfig, which lives in `risk-config` and isn't reachable without violating ARCHITECTURE.md's no-cross-module-import rule until that lookup is promoted to `shared/` (not yet done, no consumer has forced it). Flagged in `docs/feature/monetization-config.md`, not fixed, to avoid an unplanned refactor of already-shipped code." },
  { "id": "33", "title": "Implement AdminAccount authentication (email + bcrypt password, JWT issuance)", "description": "Lets an admin log into apps/admin with email/password instead of the OAuth/OTP providers used by end users (decision 67).", "scope": ["src/modules/auth/admin-account.interface.ts", "src/modules/auth/admin-account.repository.ts", "src/modules/auth/admin-login.service.ts", "src/modules/auth/admin-login.controller.ts", "src/modules/auth/admin-login.routes.ts", "src/migrations/sql/018_admin_account.sql", "scripts/seed-admin.ts"], "acceptance": ["POST /auth/admin-login with correct credentials returns a JWT with role=admin", "POST /auth/admin-login with a wrong password or unknown email returns 401, never revealing which"], "depends_on": "11", "note": "Amendment (decision 67) — added when the owner asked to remove the temporary manual-QA IdentityBloc bypass and log in for real. No AdminAccount aggregate or auth-module existed in the backlog; AuthenticateWithProvider (decision 31) only covers Google/Apple/Facebook/OTP, which don't fit an internal admin panel. Mounted at /auth/admin-login (outside /api, alongside the not-yet-built /auth/login), so it's reachable before a JWT exists." }
]
```

## Save

Saved to: `D:\ProjetoVGR\api\docs\specs\vgr\003-api-tactical-design.md`
