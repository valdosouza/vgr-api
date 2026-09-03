-- B3 of plano-moderacao-painel.md (decisions 161/165): the panel gets a
-- PROACTIVE moderation queue. There is no user "flag content" signal yet
-- (161 — that is a future mobile front); the queue is simply every case
-- that is open, not yet reviewed, not hidden (a hidden case was already
-- moderated) and not purged, ordered by risk tier (shared/risk), presence
-- of media, then age.
--
-- "Reviewing" is ONE human holding `reports` UPDATE (165 — no new
-- interface: the grant declared in 038 already reads "moderate / mark
-- reviewed") stamping reviewed_at / reviewed_by; it is audited (116) but
-- needs no reason — it is not a moderation act, it just says "eyes were
-- on it". Un-review does not exist in this phase. Like hidden (039),
-- these are OWN columns orthogonal to status / frozen / retention: the
-- expiry clock and the purge job never look at them (25/131).
--
-- The composite key serves the queue's WHERE (status = 'open' AND
-- reviewed_at IS NULL).

ALTER TABLE tb_report
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD KEY idx_report_review (status, reviewed_at),
  ADD CONSTRAINT fk_report_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES tb_user (id);
