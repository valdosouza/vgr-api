-- RT1 of plano-rating.md (decisions 48, 178-189): the reporter rates a
-- helper once the case is resolved. The rating accumulates on the
-- helper's INTERNAL identity (tb_user_account) — the platform knows who
-- is who (23/60), the interface never shows it (48). The HelperRating
-- aggregate of the tactical spec (task 26, amended 2026-09-03: module
-- src/modules/ratings, migration 045 — 011 was long taken).
--
-- Only a helper WITH an account is ratable (180), even one who chose
-- anonymity toward the reporter (tb_help_offer.anonymous = 'S'): the
-- account is always recorded when it exists (23/32), so helper_account_id
-- is NOT NULL here. One rating per offer, immutable (183) — the UNIQUE
-- key on tb_help_offer_id makes a second attempt collide, and the service
-- answers 409 ALREADY_RATED. client_key is the app-generated idempotency
-- key (pattern of 137): its UNIQUE key makes an offline-queue replay
-- collide too, and the service answers the SAME rating. No text (182) —
-- a score of 1..5 is all the row holds, so the purge of the case has
-- nothing to zero here (187: reputation is not evidence, the row stays).
-- No update and no delete path exists (183) — `deleted` is the house
-- convention only. The (report, helper) pair is NOT a key on purpose: a
-- rating is per OFFER, and the offer already carries the pair.
--
-- Rollback (manual — the runner is forward-only): DROP TABLE
-- tb_helper_rating, then remove the 'helper.rating' row of
-- tb_legal_capability.

CREATE TABLE IF NOT EXISTS tb_helper_rating (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  tb_help_offer_id  INT NOT NULL,
  tb_report_id      INT NOT NULL,
  helper_account_id INT NOT NULL,
  score             TINYINT NOT NULL,
  client_key        CHAR(36) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted           CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_helper_rating_offer (tb_help_offer_id),
  UNIQUE KEY uq_helper_rating_client_key (client_key),
  KEY idx_helper_rating_report (tb_report_id),
  -- The helper's own aggregate (184) and the future trust weight (27/189)
  -- read by helper.
  KEY idx_helper_rating_helper (helper_account_id),
  CONSTRAINT fk_helper_rating_offer FOREIGN KEY (tb_help_offer_id) REFERENCES tb_help_offer (id),
  CONSTRAINT fk_helper_rating_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT fk_helper_rating_helper FOREIGN KEY (helper_account_id) REFERENCES tb_user_account (id),
  -- RatingScore of the spec (182): an integer 1..5, nothing else.
  CONSTRAINT chk_helper_rating_score CHECK (score BETWEEN 1 AND 5)
);

-- Legal capability of decision 188: reputation is profiling of a person
-- and its risk varies by jurisdiction, like the chat (176). Wired in this
-- same delivery (helper-rating.service asserts it before the insert), so
-- it never sits in PENDING_WIRING — pattern of 033/043.
INSERT INTO tb_legal_capability (capability, description, module) VALUES
  ('helper.rating', 'Reporter rates a helper once the case is resolved - reputation on the internal identity (decisions 48, 178-189)', 'ratings');
