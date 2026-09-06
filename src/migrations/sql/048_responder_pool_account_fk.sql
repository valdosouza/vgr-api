-- Integrity fix found by the first manual end-to-end run (2026-09-06):
-- tb_responder_pool_membership.user_id has meant tb_user_account.id (a
-- mobile user, decision 51) since PP1 corrected the request route's
-- plane, but migration 012 never declared the foreign key — so a row
-- written by the OLD, mis-planed POST (which stored an admin's tb_user.id)
-- survived as an "approved" responder that no app account matches.
-- PP1's tb_panic_alert_recipient DOES enforce the FK, so snapshotting that
-- dangling row made every panic trigger fail with a 500 — an emergency
-- action refused because of stale operational data (the opposite of
-- decision 65's "the click is never blocked").
--
-- Two layers: responder-pool.repository.findActiveMembers now joins
-- tb_user_account so a dangling membership can never reach the snapshot
-- (code), and this migration removes the dangling rows and adds the
-- constraint that would have caught the plane bug on day one (data).
--
-- Rollback (manual — the runner is forward-only): ALTER TABLE
-- tb_responder_pool_membership DROP FOREIGN KEY
-- fk_responder_pool_membership_account. The deleted rows were never
-- valid memberships (no such account) and are not restorable by design.

DELETE FROM tb_responder_pool_membership
WHERE user_id NOT IN (SELECT id FROM tb_user_account);

ALTER TABLE tb_responder_pool_membership
  ADD CONSTRAINT fk_responder_pool_membership_account
    FOREIGN KEY (user_id) REFERENCES tb_user_account (id);
