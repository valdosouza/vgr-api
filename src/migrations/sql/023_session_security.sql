-- Session revocation and per-account protection (decisions 112, 113 —
-- security plan AI/docs/plans/plano-seguranca.md, phase S2).

-- session_version: stamped into every JWT at login; authMiddleware compares
-- token vs DB (60s cache). Deactivating a user, changing their password or
-- an explicit "drop sessions" bumps it — every session dies in <=60s.
-- failed_login_count: progressive delay after the 5th consecutive failure
-- (decision 113 — no hard lockout, it would weaponize the admin's e-mail).
-- recovery_attempt_count: 5 wrong codes invalidate the recovery code.
ALTER TABLE tb_user
  ADD COLUMN session_version        INT NOT NULL DEFAULT 1,
  ADD COLUMN failed_login_count     INT NOT NULL DEFAULT 0,
  ADD COLUMN recovery_attempt_count INT NOT NULL DEFAULT 0;
