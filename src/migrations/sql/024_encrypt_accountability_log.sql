-- At-rest encryption of the accountability log (decisions 44/111 — phase
-- S3 of the security plan). ip_address and metadata now store envelope
-- payloads (v1.k<ver>.<...>), not clear text: asset #1 of decision 110 —
-- the identity<->report correlation — becomes binary garbage to anyone
-- holding only the database.
--
-- Envelope payloads are longer than the raw values: widen both columns.
-- Rows written before this migration (dev-only data) remain readable via
-- the isEnvelope() prefix check; production starts encrypted from day one.
ALTER TABLE tb_accountability_log
  MODIFY COLUMN ip_address TEXT NOT NULL,
  MODIFY COLUMN metadata   MEDIUMTEXT NULL;
