# Risk Config

## OVERVIEW
Admin-managed registry mapping each Category to a RiskTier (low/medium/high), TTL-cached in memory (decision 46). Read by every other module that needs to branch on Category risk (mandatory anonymity, hidden engagement, payment mode).

## STRUCTURE
```
src/modules/risk-config/
├── risk-config.interface.ts             # RiskTier, RiskTierConfigRow
├── risk-config.dto.ts                   # Zod: { tier: 'low'|'medium'|'high' }
├── risk-config.repository.ts            # SQL: findByCategory, upsert
├── risk-config.service.ts               # getRiskTier (TTL cache, defaults 'low'), setRiskTier (invalidates cache)
├── risk-config.controller.ts            # GET (list) + PUT handlers
├── risk-config.routes.ts                # GET /, PUT /:category — both requireAdmin-gated
├── category-form-schema.interface.ts     # FieldDefinition, CategoryFormSchemaRow
├── category-form-schema.dto.ts           # Zod: { fields: FieldDefinition[] } (min 1)
├── category-form-schema.repository.ts    # SQL: findByCategory, upsert (fields stored as JSON column)
├── category-form-schema.service.ts       # getCategoryFormSchema (TTL cache), setCategoryFormSchema, validateReportDetailFields
├── category-form-schema.controller.ts    # GET (list) + PUT handlers
├── category-form-schema.routes.ts        # GET /, PUT /:category — both requireAdmin-gated
└── __tests__/
```

Both mounted via `src/gateway/router.ts` (`/api/risk-config`, `/api/category-forms`), both gated by `src/gateway/require-admin.middleware.ts` (shared — every admin-config module reuses this).

## STATUS
- Task 22 (RiskTierConfig) — DONE. TTL = 60s. Default tier for an unconfigured Category is `low` (amendment — not specified in the tactical design, decided here as the safest default).
- Task 23 (CategoryFormSchema) — DONE. Same TTL-cache shape as risk-config. `validateReportDetailFields` is built but not yet wired into `SubmitReport` — that's task 24's job.
- `parseBody` in `shared/http/controller-utils.ts` was amended from 400 → 422 for validation failures, to match `004-api-test-scenarios.md`'s consistent expectation — affects every controller, not just this module.
- Consumed by: admin tasks 02-04 (`apps/admin`), and later by task 24 (mandatory anonymity + detail-field enforcement on Report submission/reads).
- **Forward note**: `monetization-config` (task 32) needs a read-only RiskTier lookup to enforce "high-tier Categories can't allow peer_to_peer" but can't import this module directly (`ARCHITECTURE.md`'s no-cross-module-import rule). When task 24 is built (it has the same need), promote `getRiskTier` to `shared/risk/risk-tier.service.ts` and have both this module and `monetization-config` depend on that instead of duplicating the TTL-cache logic.

## REFERENCES

- [**README.md**](../README.md): Documentation navigation index.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern this feature follows.
