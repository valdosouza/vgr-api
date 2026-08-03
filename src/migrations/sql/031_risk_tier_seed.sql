-- Safe-default risk tiers for every seeded category (decisions 40/46/135,
-- R2 of plano-denuncia.md). The unconfigured default is 'low' (task-22
-- amendment), and 'low' means STREET-LEVEL precision on the public feed
-- (decision 135) — for assault (domestic violence) that would expose the
-- victim's home. So every category ships with a conscious tier that the
-- admin can change at runtime (decision 46); INSERT IGNORE never
-- overwrites an existing admin choice.
--
-- High = decision 40's shape: retaliation risk, mandatory anonymity,
-- hidden engagement, neighborhood-level position.

INSERT IGNORE INTO tb_risk_tier_config (category, tier) VALUES
  ('assault',          'high'),
  ('homicide',         'high'),
  ('kidnapping',       'high'),
  ('trafficking',      'high'),
  ('fugitive',         'high'),
  ('missing',          'medium'),
  ('robbery',          'medium'),
  ('illegal_commerce', 'medium'),
  ('suspicious',       'low'),
  ('environmental',    'low'),
  ('traffic',          'low'),
  ('vandalism',        'low');
