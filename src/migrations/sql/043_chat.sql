-- C1 of plano-chat.md (decisions 54, 168-177): the masked reporter <->
-- helper chat. A NEW bounded context (messaging, spec task 29 as amended)
-- on the app plane.
--
-- One thread per (report, helper ACCOUNT) — decision 169: only a routable
-- identity talks. A helper who offered help WITHOUT an account has no
-- identity on the server after the offer (tb_help_offer.helper_account_id
-- NULL) and therefore never gets a thread; the app warns them before they
-- offer. The reporter joins by account OR by the report's client_key
-- (bearer secret, 134/137). The UNIQUE key makes the find-or-create of
-- decision 173 race-free: two first messages collide and the loser reads
-- the winner's thread.

CREATE TABLE IF NOT EXISTS tb_chat_thread (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  tb_report_id      INT NOT NULL,
  helper_account_id INT NOT NULL,
  help_offer_id     INT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted           CHAR(1) NOT NULL DEFAULT 'N',
  UNIQUE KEY uq_chat_thread_helper (tb_report_id, helper_account_id),
  KEY idx_chat_thread_report (tb_report_id),
  CONSTRAINT fk_chat_thread_report FOREIGN KEY (tb_report_id) REFERENCES tb_report (id),
  CONSTRAINT fk_chat_thread_helper FOREIGN KEY (helper_account_id) REFERENCES tb_user_account (id),
  CONSTRAINT fk_chat_thread_offer FOREIGN KEY (help_offer_id) REFERENCES tb_help_offer (id)
);

-- The participant mask (spec MaskedIdentity, decision 170): `token` is the
-- ONLY identity that ever leaves the API — 32 hex chars from 16 random
-- bytes, unique per (thread, participant), never reused across threads or
-- reports. account_id / client_key keep the internal link (the platform
-- always knows who is who, 23/60); they never reach a payload.
-- last_read_message_id is the reader's OWN pointer (unread count, 172) —
-- it is not a receipt: the other side never sees it (174).
CREATE TABLE IF NOT EXISTS tb_chat_participant (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  tb_chat_thread_id     INT NOT NULL,
  role                  VARCHAR(10) NOT NULL,
  account_id            INT NULL,
  client_key            CHAR(36) NULL,
  token                 CHAR(32) NOT NULL,
  last_read_message_id  BIGINT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_participant_token (token),
  UNIQUE KEY uq_chat_participant_role (tb_chat_thread_id, role),
  CONSTRAINT fk_chat_participant_thread FOREIGN KEY (tb_chat_thread_id) REFERENCES tb_chat_thread (id),
  CONSTRAINT fk_chat_participant_account FOREIGN KEY (account_id) REFERENCES tb_user_account (id),
  CONSTRAINT chk_chat_participant_role CHECK (role IN ('reporter', 'helper'))
);

-- Messages: append-only (decision 177 — no edit, no delete by the author;
-- no PUT/DELETE route exists). client_key is the app-generated idempotency
-- key of decision 172 (pattern of 137): the UNIQUE key makes an offline
-- queue replay collide and the service answers the SAME message. Purge
-- (25/131) nulls `text` and sets purged='S' — rows, counts and timestamps
-- stay as the statistical skeleton, like tb_report. The (sender,
-- created_at) key serves the sliding rate window of decision 177, counted
-- in the DB.
CREATE TABLE IF NOT EXISTS tb_chat_message (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  tb_chat_thread_id     INT NOT NULL,
  sender_participant_id INT NOT NULL,
  client_key            CHAR(36) NOT NULL,
  text                  TEXT NULL,
  purged                CHAR(1) NOT NULL DEFAULT 'N',
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_chat_message_client_key (tb_chat_thread_id, client_key),
  KEY idx_chat_message_thread (tb_chat_thread_id, id),
  KEY idx_chat_message_sender (sender_participant_id, created_at),
  CONSTRAINT fk_chat_message_thread FOREIGN KEY (tb_chat_thread_id) REFERENCES tb_chat_thread (id),
  CONSTRAINT fk_chat_message_sender FOREIGN KEY (sender_participant_id) REFERENCES tb_chat_participant (id)
);

-- Legal capability of decision 176: chat between anonymous parties has
-- jurisdiction-dependent legal risk (like media, 138). Wired in this same
-- delivery (chat.service asserts it before thread creation and before
-- every post), so it never sits in PENDING_WIRING — pattern of 033.
INSERT INTO tb_legal_capability (capability, description, module) VALUES
  ('chat.masked', 'Masked text chat between the reporter and a helper (decisions 54, 169-177)', 'messaging');
