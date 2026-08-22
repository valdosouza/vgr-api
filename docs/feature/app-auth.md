# App Authentication (accounts)

## OVERVIEW
Authentication for **app users** — reporters and helpers (decisions 119-124). Deliberately separate from the panel plane (`tb_user`, `docs/feature/auth.md`): different tables, different JWT audience, cross-rejected middlewares. A weakness in this plane can never reach the panel that grants privileges and decrypts life-at-risk data (decisions 45, 110).

Shaped by decision 123 — **"a denúncia nunca espera"**: signing up and reporting demand nothing beyond consent; verification is required only before actions with consequences.

## STRUCTURE
```
src/shared/auth/
├── audience.ts          # Audiences.ADMIN | Audiences.APP (decision 119)
├── app-session.ts       # 30min access token + opaque rotating refresh (decision 122)
└── social-verifier.ts   # verifyProviderToken — Google wired (JWKS via google-auth-library),
                         #   Apple/Facebook 422 NOT_AVAILABLE until their credentials exist

src/gateway/app-auth.middleware.ts   # app-plane guard; rejects panel tokens by audience

src/modules/accounts/
├── account.interface.ts   # UserAccountRow, VerifiedProviderIdentity, AppSession
├── account.dto.ts         # register/login/refresh/provider — password policy from decision 114
├── account.repository.ts  # accounts, provider links, refresh tokens
├── account.service.ts     # all the rules below
├── account.controller.ts / account.routes.ts
└── __tests__/

src/migrations/sql/027_user_account.sql   # tb_user_account, tb_user_account_provider,
                                          # tb_user_refresh_token
```

Mounted at `/app-auth` (outside `/api`, which is the panel plane).

## KEY BEHAVIORS
- **Plane separation (119)**: panel tokens carry `aud: admin`, app tokens `aud: app`; `jwt.verify` enforces the audience on both middlewares. `plane-separation.spec.ts` proves both rejections.
- **Sessions (122)**: 30-minute access token + opaque refresh (random, hashed with SHA-256 before storage — a self-contained token could not be revoked), 90 days, single use. Rotation keeps the `family_id`; **reusing a rotated token revokes the whole family and bumps `session_version`** — the classic fingerprint of theft. `session_version` also gives the panel's ≤60s revocation.
- **Provider linking (121)**: auto-link only when the email is verified on **both** sides. Provider verified + local account unverified → 409 `link_requires_password` (the takeover vector). Unverified provider email → new account, no lookup. **Apple private relay never auto-links and is not stored** — it is an alias, not an identity. Unlinking never leaves an account without a sign-in method.
- **Google login (152)**: `POST /app-auth/login-provider` `{provider, idToken}` — the ONLY place a raw client token is accepted. `social-verifier.ts#verifyProviderToken` sends it to `verifyGoogleIdToken`, which uses `google-auth-library`'s `OAuth2Client.verifyIdToken` (fetches Google's JWKS, checks signature/`iss`/`exp`, and `aud` against `GOOGLE_OAUTH_CLIENT_ID` — the **Web-type** OAuth client id, not the Android/iOS ones, since that is what a `google_sign_in` client configures as `serverClientId` to get an ID token usable server-side). Only `sub`/`email`/`email_verified`/`name` cross into `VerifiedProviderIdentity` (decision 110/119 minimization) before `account.service#loginWithProvider` runs the linking rules above. Empty `GOOGLE_OAUTH_CLIENT_ID` fails closed with 422 `NOT_AVAILABLE`, same shape as the L2 gate. Apple/Facebook still answer `NOT_AVAILABLE` — no credentials yet.
- **Verification gate (123)**: `assertVerifiedForConsequentialAction` is called by domain services before offering/claiming a reward or requesting responder status — **never on the reporting path**.
- **Password (124)**: same policy as the panel (min 12, no composition rules). Social-only accounts have `password_hash = null`, so the policy simply does not apply to them — that was the "does it collide with social login?" question, answered structurally.
- **TOTP (124)**: optional, and it belongs to the **account**, not the method — enabling it guards password login and any other.
- **Progressive delay (113)**: reused from the panel, per account, including on a wrong second factor.

## STATUS
- Password registration/login, refresh rotation, revocation, provider linking rules, verification gate — DONE, 35 suites / 213 tests green.
- **Email verification BUILT in 2026-08-22** (decision 151, closes round-6 item 2): `POST /app-auth/verify-email/send` (authenticated; silent no-op with no email or already verified) + `POST /app-auth/verify-email/confirm` `{code}`. Reuses `shared/mailer`, but keeps its **own** 6-digit code / 15-minute TTL / attempt counter on `tb_user_account` (migration 037) — the panel's `activation_key` row is never touched (decision 119 keeps the two planes separate). 5 wrong attempts wipes the code, same pattern as the panel's password recovery (decision 113). Never called on the reporting path (decision 123) — only where `assertVerifiedForConsequentialAction` already gated.
- **Google login BUILT in 2026-08-22**: `POST /app-auth/login-provider` wired end-to-end (`social-verifier.ts` + `account.controller.ts`), gated by `GOOGLE_OAUTH_CLIENT_ID`. 6 new tests (`social-verifier.spec.ts`), 419 tests / 58 suites green, tsc clean. Apple/Facebook adapters remain deferred (decision 152) — still no credentials in those consoles.
- **Phone/WhatsApp OTP (decision 120) is blocked on a commercial choice**: no sending provider has been selected (same shape as the PSP pendency of decision 59). Round-6 item 1, still open — the only thing left in round 6.
- **Mobile side**: `app/docs/feature/app-auth.md` covers email+password (built) — the "Entrar com Google" button is NOT built yet even though the server side now supports it; needs the `google_sign_in` package wired to the Android client (SHA-1 registered against `com.setes.vgr`) and this endpoint.

## REFERENCES
- [**auth.md**](./auth.md): the panel plane — the other side of decision 119.
- [**legal-gate.md**](./legal-gate.md): `requireCapability`, which will stack on app routes carrying legal risk.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern.
- `app/docs/feature/app-auth.md`: the mobile screens driving this API (register/login/verify-email/sign-out, session persistence, entry points).
