# Auth (admin login)

## OVERVIEW
Email/password login for `apps/admin` (decision 67) — separate from decision 31's Google/Apple/Facebook/OTP providers, which are for end users on `apps/mobile` and don't fit an internal panel. Since migration 019 the account table is `tb_user` (decision 74 — `tb_admin_account` evolved into the team user): login also requires `active='S'`/`deleted='N'` (same generic 401 either way) and stamps `last_login_at`. What the JWT holder can do is decided per privilege by `requirePrivilege` (see [access-control.md](./access-control.md)), never by the `role` claim. Everyday account creation happens on the Users screen (decision 75); `scripts/seed-admin.ts` remains only as first-account bootstrap (it also grants every cataloged privilege — decision 70).

## STRUCTURE
```
src/modules/auth/
├── admin-account.interface.ts   # AdminAccountRow (+ sessionVersion, failedLoginCount, totpSecret)
├── admin-account.repository.ts  # account lookups, session/failure counters, TOTP + recovery codes
├── admin-login.dto.ts           # Zod: { email, password, totpCode? }
├── admin-login.service.ts       # authenticateAdmin (two-step), signSession, renewSession
├── admin-login.controller.ts
├── admin-login.routes.ts        # POST /admin-login, /recovery-password, /change-password, /2fa/*
├── password-recovery.service.ts # 6-digit code, 15min window, attempt cap
├── two-factor.service.ts        # TOTP enrollment/activation/recovery (decision 114)
└── __tests__/

src/shared/acl/session-store.ts      # session_version lookup, 60s TTL cache (decision 112)
src/shared/security/login-delay.ts   # progressive per-account delay (decision 113)
src/shared/security/totp.ts          # RFC 6238, no external dependency
src/shared/auth/audience.ts          # aud: 'admin' vs 'app' (decision 119)

scripts/seed-admin.ts            # tsx scripts/seed-admin.ts <email> <password> — bcrypt-hashes, upserts
```

Mounted at `/auth/admin-login` in `src/app.ts` — deliberately **outside** `/api` and registered *before* `authMiddleware`, since this is how a JWT is obtained in the first place (mirrors the not-yet-built `/auth/login` for end-user OAuth/OTP).

## STATUS
- Task 33 (decision 67) — DONE. Phase 2 of the admin-controls plan added password recovery and closed the rate-limit gap.
- Same 401 message and status for an unknown email, a wrong password AND a deactivated account (`authenticateAdmin`'s `invalidCredentials()`) — never reveals which one it was.
- `POST /auth/recovery-password` + `POST /auth/change-password` (`password-recovery.service.ts`): 6-digit code via `shared/mailer` (SMTP by .env; dev mode logs the code), 15-minute window on `tb_user.activation_key`, generic responses against user enumeration, bcrypt on the new password.
- `/auth` is rate-limited harder than `/api` (`authRateLimitMiddleware`, 10 req/min/IP) — the previously flagged gap is closed.
- Consumed by: `apps/admin`'s login/recovery flow (login page with "keep me signed in" per decision 73).

## SECURITY ROUND (decisions 110-119) — what changed here

- **Session is 15 minutes and revocable (112)**. The JWT carries `sv` =
  `tb_user.session_version`; `authMiddleware` compares it against the DB
  through a 60s cache. Deactivating a user, changing their password or
  deleting them bumps the version and kills **every** outstanding token in
  ≤60s. `POST /api/auth/renew` slides the session without storing
  credentials on the client.
- **Progressive delay, never a hard lockout (113)**. From the 5th
  consecutive failure the same account waits 1s, 2s, 4s… capped at 30s;
  success clears it. Hard lockout was rejected on purpose: it would turn a
  known admin e-mail into a denial-of-service weapon while that admin may
  be mid-emergency (decision 45). A wrong TOTP code counts too.
- **Recovery code cap (113)**: 5 wrong codes wipe the code entirely; a new
  request resets the counter.
- **Mandatory TOTP 2FA (114)**. Login is two-step: password accepted but
  not enrolled → 10-minute enroll-scope token usable **only** on
  `/auth/2fa/*` (no session exists before enrollment completes); enrolled →
  `totpCode` required, otherwise 401 `TWO_FACTOR_REQUIRED`. The secret is
  stored envelope-encrypted (decisions 44/111) so a leaked database does
  not hand out the second factor with the hashes. Ten single-use recovery
  codes are shown once and stored bcrypt-hashed; using one clears TOTP and
  forces re-enrollment. Losing both device and codes is unlocked by
  ANOTHER admin at `POST /api/users/:id/2fa/reset` (users:UPDATE +
  `dual_control_approval`), and self-reset is refused (decisions 45/70).
- **Password policy (114)**: `shared/security/password-policy.ts`, minimum
  12, no composition rules, common/sequence/repeat rejection. Applies to
  new passwords only — existing ones stay valid until the next change.
- **Plane separation (119)**: tokens minted here carry `aud: 'admin'` and
  are rejected on the app plane; app tokens are rejected here. See
  [app-auth.md](./app-auth.md).

⚠️ **Deploy note**: these changed the login response shape and the token
contract — API and `apps/admin` must be deployed together.

## REFERENCES
- [**README.md**](../README.md): Documentation navigation index.
- [**identity.md**](./identity.md): `Role`/`AuthenticatedUser` shape this issues a JWT for.
- [**app-auth.md**](./app-auth.md): the OTHER authentication plane (app users) — never crossed with this one.
- [**access-control.md**](./access-control.md): `requirePrivilege`, which decides what the holder can do.
