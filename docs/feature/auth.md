# Auth (admin login)

## OVERVIEW
Email/password login for `apps/admin` (decision 67) — separate from decision 31's Google/Apple/Facebook/OTP providers, which are for end users on `apps/mobile` and don't fit an internal panel. No self-registration: `AdminAccount` rows are seeded/created manually via `scripts/seed-admin.ts`.

## STRUCTURE
```
src/modules/auth/
├── admin-account.interface.ts   # AdminAccountRow (id, email, passwordHash)
├── admin-account.repository.ts  # findAdminAccountByEmail, upsertAdminAccount (seed-only)
├── admin-login.dto.ts           # Zod: { email, password }
├── admin-login.service.ts       # authenticateAdmin — bcrypt.compare, issues JWT { userId, role: 'admin' }
├── admin-login.controller.ts
├── admin-login.routes.ts        # POST /admin-login
└── __tests__/

scripts/seed-admin.ts            # tsx scripts/seed-admin.ts <email> <password> — bcrypt-hashes, upserts
```

Mounted at `/auth/admin-login` in `src/app.ts` — deliberately **outside** `/api` and registered *before* `authMiddleware`, since this is how a JWT is obtained in the first place (mirrors the not-yet-built `/auth/login` for end-user OAuth/OTP).

## STATUS
- Task 33 (decision 67) — DONE.
- Same 401 message and status for an unknown email and a wrong password (`authenticateAdmin`'s `invalidCredentials()`) — never reveals which one was wrong.
- No rate-limiting on this endpoint yet — `rateLimitMiddleware` is only mounted on `/api`, not `/auth`. Acceptable for now (single seeded admin, low traffic), but flagged: revisit once more than one admin account exists.
- Consumed by: `apps/admin`'s real login flow (replacing the temporary manual-QA `IdentityBloc` bypass used earlier in this session).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**identity.md**](./identity.md): `Role`/`AuthenticatedUser` shape this issues a JWT for.
