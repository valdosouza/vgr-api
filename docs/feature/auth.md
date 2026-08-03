# Auth (admin login)

## OVERVIEW
Email/password login for `apps/admin` (decision 67) — separate from decision 31's Google/Apple/Facebook/OTP providers, which are for end users on `apps/mobile` and don't fit an internal panel. Since migration 019 the account table is `tb_user` (decision 74 — `tb_admin_account` evolved into the team user): login also requires `active='S'`/`deleted='N'` (same generic 401 either way) and stamps `last_login_at`. What the JWT holder can do is decided per privilege by `requirePrivilege` (see [access-control.md](./access-control.md)), never by the `role` claim. Everyday account creation happens on the Users screen (decision 75); `scripts/seed-admin.ts` remains only as first-account bootstrap (it also grants every cataloged privilege — decision 70).

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
- Task 33 (decision 67) — DONE. Phase 2 of the admin-controls plan added password recovery and closed the rate-limit gap.
- Same 401 message and status for an unknown email, a wrong password AND a deactivated account (`authenticateAdmin`'s `invalidCredentials()`) — never reveals which one it was.
- `POST /auth/recovery-password` + `POST /auth/change-password` (`password-recovery.service.ts`): 6-digit code via `shared/mailer` (SMTP by .env; dev mode logs the code), 15-minute window on `tb_user.activation_key`, generic responses against user enumeration, bcrypt on the new password.
- `/auth` is rate-limited harder than `/api` (`authRateLimitMiddleware`, 10 req/min/IP) — the previously flagged gap is closed.
- Consumed by: `apps/admin`'s login/recovery flow (login page with "keep me signed in" per decision 73).

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**identity.md**](./identity.md): `Role`/`AuthenticatedUser` shape this issues a JWT for.
