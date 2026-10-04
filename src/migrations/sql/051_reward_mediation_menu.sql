-- Round 20, decision 234 (AI/docs/plans/plano-rodada-20-painel.md):
-- the reward mediation screen goes on the panel menu.
--
-- Migration 035 cataloged `reward_mediation` as a kind 'R' resource, "not
-- on the menu tree" — but the panel has a screen for it (criteria
-- publishing + the case flow) and nothing linked to it: it opened only by
-- typing the URL (browser test of 2026-10-04). As a kind 'T' screen it is
-- listed for whoever holds VIEW, in Operations right after Monetization
-- Config (position 5, id after it). The API guards do not change: the
-- mediation routes keep asking for `reward_mediation` VIEW/UPDATE, and the
-- grants given by 035's bootstrap stay as they are.
UPDATE tb_interface
   SET kind = 'T'
 WHERE i18n_key = 'reward_mediation' AND kind = 'R';
