-- HT1 of plano-oferta-multitipo.md (decisions 208-214, 2026-09-11).
--
-- A helper can act on SEVERAL fronts of decision 10 at once (208): the
-- single `help_type` column of migration 032 becomes a child table
-- (209), one row per (offer, type). The offer itself stays the one
-- helper <-> report link (uq_offer_helper untouched): chat (043), rating
-- (045) and reward recipients (035) keep pointing at tb_help_offer.
--
-- Backfill copies every existing offer's single type, then the old column
-- and its CHECK go away (210) — one source of truth, no "primary type".
CREATE TABLE IF NOT EXISTS tb_help_offer_type (
  tb_help_offer_id INT NOT NULL,
  help_type        VARCHAR(30) NOT NULL,
  PRIMARY KEY (tb_help_offer_id, help_type),
  CONSTRAINT fk_offer_type_offer FOREIGN KEY (tb_help_offer_id)
    REFERENCES tb_help_offer (id) ON DELETE CASCADE,
  -- Fixed list of decision 10, same as the CHECK 032 carried.
  CONSTRAINT chk_offer_type_value CHECK (help_type IN
    ('physical_presence', 'relay_information', 'remote_support', 'share', 'financial_contribution'))
);

INSERT IGNORE INTO tb_help_offer_type (tb_help_offer_id, help_type)
  SELECT id, help_type FROM tb_help_offer;

ALTER TABLE tb_help_offer DROP CONSTRAINT IF EXISTS chk_offer_type;
ALTER TABLE tb_help_offer DROP COLUMN IF EXISTS help_type;
