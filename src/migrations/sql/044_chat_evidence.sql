-- C3 of plano-chat.md (decision 175): the panel can READ a case's masked
-- chat, under its own grant, every read audited (116/166). One interface:
--
--   chat_evidence  — kind 'R' resource (mechanism of decision 93). VIEW =
--                    reading every thread of a case with the participants
--                    resolved for the platform (23/60): the helper always
--                    identified, the reporter only when the report is not
--                    anonymous (160). Deliberately separate from `reports`:
--                    the chat is where retaliation and abuse tend to
--                    happen, and its text is evidence of the same nature as
--                    the photo (130) — being able to review a case must not
--                    silently include reading the conversation. Read only:
--                    there is no privilege to post, hide or delete a
--                    message (175).

INSERT INTO tb_interface (description, i18n_key, group_default, kind, position) VALUES
  ('Chat Evidence', 'chat_evidence', 'Operations', 'R', 7);

-- VIEW is the single act the resource governs.
INSERT INTO tb_interface_has_privilege (tb_interface_id, tb_privilege_id)
SELECT i.id, p.id
FROM tb_interface i, tb_privilege p
WHERE i.i18n_key = 'chat_evidence' AND p.description = 'VIEW';

-- chat_evidence gets NO bootstrap on purpose (decision 175 — same posture
-- as media_original in 029 and report_exact_position in 038): nobody reads
-- a conversation until a human explicitly grants it (minimization,
-- decision 110 — the safe default is the empty grant).
