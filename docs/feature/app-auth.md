# App Authentication (accounts)

## OVERVIEW
Authentication for **app users** — reporters and helpers (decisions 119-124). Deliberately separate from the panel plane (`tb_user`, `docs/feature/auth.md`): different tables, different JWT audience, cross-rejected middlewares. A weakness in this plane can never reach the panel that grants privileges and decrypts life-at-risk data (decisions 45, 110).

Shaped by decision 123 — **"a denúncia nunca espera"**: signing up and reporting demand nothing beyond consent; verification is required only before actions with consequences.

## STRUCTURE
```
src/shared/auth/
├── audience.ts        # Audiences.ADMIN | Audiences.APP (decision 119)
└── app-session.ts     # 30min access token + opaque rotating refresh (decision 122)

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
- **Verification gate (123)**: `assertVerifiedForConsequentialAction` is called by domain services before offering/claiming a reward or requesting responder status — **never on the reporting path**.
- **Password (124)**: same policy as the panel (min 12, no composition rules). Social-only accounts have `password_hash = null`, so the policy simply does not apply to them — that was the "does it collide with social login?" question, answered structurally.
- **TOTP (124)**: optional, and it belongs to the **account**, not the method — enabling it guards password login and any other.
- **Progressive delay (113)**: reused from the panel, per account, including on a wrong second factor.

## STATUS
- Password registration/login, refresh rotation, revocation, provider linking rules, verification gate — DONE, 35 suites / 213 tests green.
- **Provider verification adapters are NOT built**: `loginWithProvider` accepts an *already verified* identity, so wiring Google/Apple (OIDC JWKS) and Facebook (Graph `debug_token`) is additive and does not touch these rules. No endpoint exposes provider login until then — deliberately, so nothing can accept an unverified client token.
- **Phone/WhatsApp OTP (decision 120) is blocked on a commercial choice**: no sending provider has been selected (same shape as the PSP pendency of decision 59). Round-6 item.
- Email/phone verification *sending* is not built either (the panel's mailer exists; the flow is a small addition once the OTP provider question is settled).

## REFERENCES
- [**auth.md**](./auth.md): the panel plane — the other side of decision 119.
- [**legal-gate.md**](./legal-gate.md): `requireCapability`, which will stack on app routes carrying legal risk.
- [**ARCHITECTURE.md**](../adr/ARCHITECTURE.md): module pattern.
