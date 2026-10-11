# Release checklist

Mandatory steps before any release/deploy (decision 118; security plan
`AI/docs/plans/plano-seguranca.md`).

## Every release

1. `npm audit --omit=dev --audit-level=high` clean — no HIGH/CRITICAL
   advisory in what production installs. CI runs it as a gate on every push
   and pull request; this step only confirms it ran green.
2. `npx tsc --noEmit` clean and `npm test` fully green.
3. `npm run build && npm run verify:build` green (also a CI step): the
   compiled app loads with plain Node and ships every migration.
4. `package-lock.json` committed — never release from an uncommitted lock.
5. App workspace: `dart pub outdated` reviewed (no known-vulnerable pins).
6. New env vars documented in `.env.example` (never with real values).

## Production environment (decisions 110, 115)

- `JWT_SECRET` set (boot refuses to start without it).
- `CORS_ORIGIN` set to the explicit panel origin list (boot refuses `*`).
- `LEGAL_KEK` and `MEDIA_KEK` set (boot refuses to start without them —
  decisions 111/126); their offline copy exists (decision 243).
- `LEGAL_JURISDICTION` set (unset means everything fail-closed).
- `SWAGGER_ENABLED` NOT set.
- Node >= 20 (`engines` in package.json).

## Building and running in production (plano-producao.md P1)

`tsc` alone does not produce a runnable API: it leaves the `@gateway/`,
`@modules/` and `@shared/` import aliases unresolved and does not copy the
migration SQL. `npm run build` does all three: compiles `src/` (tests
excluded, `tsconfig.build.json`), rewrites the aliases to relative paths
(`tsc-alias`), and copies `src/migrations/sql` to `dist/migrations/sql`.
Everything below runs with plain Node and production dependencies only
(`npm ci --omit=dev`) — no `tsx`, no `tsconfig-paths`.

| Command | What it runs |
|---|---|
| `npm run build` | compile + rewrite aliases + copy migrations into `dist/` (needs dev dependencies — build stage only) |
| `npm run verify:build` | smoke test of `dist/`: the app loads, both CLIs exist, every migration shipped |
| `npm run db:migrate:prod` | `node dist/cli/run-migrations.js` — apply pending migrations |
| `npm run seed:admin:prod -- <email> <password>` | `node dist/cli/seed-admin.js` — first panel account, all privileges (decision 70) |
| `npm start` | `node dist/server.js` — applies pending migrations, then serves |

The runner refuses to start when it finds no migration file (absent or
empty `dist/migrations/sql`): an install that lost them must fail, never
report "Migrations completed" over an empty database.

In the server these run inside the API image (`Dockerfile`, decision 241):
the build stage runs `npm run build && npm run verify:build`, the runtime
stage has production dependencies only. Deployment steps: `DEPLOY.md`.

Development keeps the TypeScript entry points: `npm run dev`,
`npm run db:migrate`, `npm run seed:admin -- <email> <password>`.

