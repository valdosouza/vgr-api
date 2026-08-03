# Release checklist

Mandatory steps before any release/deploy (decision 118; security plan
`AI/docs/plans/plano-seguranca.md`).

## Every release

1. `npm audit` — no HIGH/CRITICAL findings unresolved. When the CI exists,
   `npm audit --audit-level=high` becomes a build gate and this manual step
   only confirms it ran.
2. `npx tsc --noEmit` clean and `npm test` fully green.
3. `package-lock.json` committed — never release from an uncommitted lock.
4. App workspace: `dart pub outdated` reviewed (no known-vulnerable pins).
5. New env vars documented in `.env.example` (never with real values).

## Production environment (decisions 110, 115)

- `JWT_SECRET` set (boot refuses to start without it).
- `CORS_ORIGIN` set to the explicit panel origin list (boot refuses `*`).
- `LEGAL_JURISDICTION` set (unset means everything fail-closed).
- `SWAGGER_ENABLED` NOT set.
- Node >= 20 (`engines` in package.json).
