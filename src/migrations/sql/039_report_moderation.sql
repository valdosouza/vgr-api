-- B2 of plano-moderacao-painel.md (decisions 162/163/165/167): the panel
-- can now MODERATE — hide/unhide a report, block/unblock a media — each
-- act by ONE human holding `reports` UPDATE (165, declared in 038), with a
-- reason from the fixed catalog in code (163: spam | abuse |
-- illegal_content | duplicate | personal_data | other) and a
-- tb_admin_audit row (116). No new interface: moderation IS `reports`
-- UPDATE.
--
-- Modelling by OWN columns, not by `status` (162): `tb_report.status` is
-- the case's lifecycle (open|resolved, CHECK of 030) and moderation is
-- orthogonal to it — as it is to `frozen` (141) and to retention
-- (`expires_at`, purge — 25/131): hiding is not erasing, the clock and
-- the purge job never look at these columns.

ALTER TABLE tb_report
  ADD COLUMN hidden CHAR(1) NOT NULL DEFAULT 'N',
  ADD COLUMN hidden_reason_code VARCHAR(30) NULL,
  ADD COLUMN hidden_note VARCHAR(500) NULL,
  ADD COLUMN hidden_at DATETIME NULL,
  ADD COLUMN hidden_by INT NULL,
  ADD KEY idx_report_hidden (hidden),
  ADD CONSTRAINT fk_report_hidden_by FOREIGN KEY (hidden_by) REFERENCES tb_user (id);

-- tb_media.status already admits 'blocked' (028) and the app plane / the
-- expiry job already respect it; until now nothing WROTE it. The block
-- carries the same reason columns; the status transition itself is
-- available <-> blocked, done by the panel endpoint.
ALTER TABLE tb_media
  ADD COLUMN blocked_reason_code VARCHAR(30) NULL,
  ADD COLUMN blocked_note VARCHAR(500) NULL,
  ADD COLUMN blocked_at DATETIME NULL,
  ADD COLUMN blocked_by INT NULL,
  ADD CONSTRAINT fk_media_blocked_by FOREIGN KEY (blocked_by) REFERENCES tb_user (id);

-- Decision 167: the owner sees a `hidden` mark, never the reason, and NO
-- timeline event is written — the timeline stays append-only without it
-- (same choice as the freeze in 032, for a different reason).
