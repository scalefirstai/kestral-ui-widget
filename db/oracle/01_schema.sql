-- F&IS Support Copilot: chat sessions and long-term memory (Oracle 19c+).
--
-- Layers
--   Registry        cplt_app, cplt_app_namespace, cplt_user
--   Conversation    cplt_session -> cplt_message -> cplt_message_context / cplt_citation / cplt_feedback
--   Long-term memory cplt_memory (+ cplt_memory_use: which memories informed which answer)
--
-- Keys line up with the widget/gateway protocol (docs/PROTOCOL.md):
--   cplt_session.session_id         = conversationId (UUID from the widget)
--   cplt_message.external_message_id = messageId from the 'done' event (used by /v1/feedback)
--   cplt_message_context             = the normalised context sent with each question
--
-- Questions, answers and error messages can contain client data: run on a TDE-encrypted
-- tablespace, grant the gateway only the cplt_chat_api package, and keep retention on.
-- Vector columns for semantic recall are in 02_vector_23ai.sql (Oracle 23ai only).

-- ---------------------------------------------------------------------------
-- Registry
-- ---------------------------------------------------------------------------
CREATE TABLE cplt_app (
  app_id          VARCHAR2(64)   NOT NULL,
  app_mnemonic    CHAR(3)        NOT NULL,
  app_name        VARCHAR2(200)  NOT NULL,
  owner_team      VARCHAR2(200),
  memory_enabled  CHAR(1)        DEFAULT 'Y' NOT NULL,
  retention_days  NUMBER(5)      DEFAULT 400 NOT NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cplt_app_pk          PRIMARY KEY (app_id),
  CONSTRAINT cplt_app_mnemonic_uk UNIQUE (app_mnemonic),
  CONSTRAINT cplt_app_mnemonic_ck CHECK (REGEXP_LIKE(app_mnemonic, '^[A-Z0-9]{3}$')),
  CONSTRAINT cplt_app_memory_ck   CHECK (memory_enabled IN ('Y', 'N')),
  CONSTRAINT cplt_app_retention_ck CHECK (retention_days BETWEEN 1 AND 3650)
);

CREATE TABLE cplt_app_namespace (
  app_id     VARCHAR2(64)  NOT NULL,
  namespace  VARCHAR2(128) NOT NULL,
  CONSTRAINT cplt_app_ns_pk  PRIMARY KEY (app_id, namespace),
  CONSTRAINT cplt_app_ns_fk  FOREIGN KEY (app_id) REFERENCES cplt_app (app_id) ON DELETE CASCADE
);

-- user_id is the identity the gateway resolved (IdP subject or Windows account), never an email body.
CREATE TABLE cplt_user (
  user_id         VARCHAR2(128) NOT NULL,
  display_name    VARCHAR2(200),
  memory_opt_out  CHAR(1)       DEFAULT 'N' NOT NULL,
  first_seen_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  last_seen_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cplt_user_pk     PRIMARY KEY (user_id),
  CONSTRAINT cplt_user_optout_ck CHECK (memory_opt_out IN ('Y', 'N'))
);

-- ---------------------------------------------------------------------------
-- Conversation
-- ---------------------------------------------------------------------------
CREATE TABLE cplt_session (
  session_id          VARCHAR2(36)  NOT NULL,
  user_id             VARCHAR2(128) NOT NULL,
  app_id              VARCHAR2(64)  NOT NULL,
  app_mnemonic        CHAR(3)       NOT NULL,          -- denormalised for reporting by mnemonic
  namespace           VARCHAR2(128),
  host_type           VARCHAR2(16),
  client_version      VARCHAR2(32),
  backend             VARCHAR2(16),
  title               VARCHAR2(200),                   -- first question, truncated
  status              VARCHAR2(16)  DEFAULT 'ACTIVE' NOT NULL,
  message_count       NUMBER(6)     DEFAULT 0 NOT NULL,
  started_at          TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  last_activity_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  closed_at           TIMESTAMP WITH TIME ZONE,
  summary             CLOB,                            -- rolling summary, the session's long-term memory
  summary_updated_at  TIMESTAMP WITH TIME ZONE,
  legal_hold          CHAR(1)       DEFAULT 'N' NOT NULL,
  retain_until        DATE          NOT NULL,
  CONSTRAINT cplt_session_pk        PRIMARY KEY (session_id),
  CONSTRAINT cplt_session_user_fk   FOREIGN KEY (user_id) REFERENCES cplt_user (user_id),
  CONSTRAINT cplt_session_app_fk    FOREIGN KEY (app_id)  REFERENCES cplt_app (app_id),
  CONSTRAINT cplt_session_host_ck   CHECK (host_type IN ('web', 'webview2', 'electron', 'none')),
  CONSTRAINT cplt_session_backend_ck CHECK (backend IN ('http', 'claude', 'mock')),
  CONSTRAINT cplt_session_status_ck CHECK (status IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT cplt_session_hold_ck   CHECK (legal_hold IN ('Y', 'N'))
);
CREATE INDEX cplt_session_user_ix   ON cplt_session (user_id, app_id, last_activity_at);
CREATE INDEX cplt_session_mnem_ix   ON cplt_session (app_mnemonic, started_at);
CREATE INDEX cplt_session_retain_ix ON cplt_session (retain_until, legal_hold);

-- One row per user question or assistant answer. For high volume on Enterprise Edition with the
-- Partitioning option, add:  PARTITION BY RANGE (created_at) INTERVAL (NUMTOYMINTERVAL(1, 'MONTH'))
--                            (PARTITION p0 VALUES LESS THAN (TIMESTAMP '2026-01-01 00:00:00 +00:00'))
CREATE TABLE cplt_message (
  message_id           NUMBER GENERATED ALWAYS AS IDENTITY,
  session_id           VARCHAR2(36)  NOT NULL,
  seq                  NUMBER(6)     NOT NULL,          -- order within the session, from 1
  role                 VARCHAR2(16)  NOT NULL,
  content              CLOB          NOT NULL,
  external_message_id  VARCHAR2(128),                   -- 'done' event messageId (Eliza / Claude)
  model                VARCHAR2(64),
  outcome              VARCHAR2(16),                    -- assistant rows only
  input_tokens         NUMBER(9),
  output_tokens        NUMBER(9),
  latency_ms           NUMBER(9),
  created_at           TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cplt_message_pk       PRIMARY KEY (message_id),
  CONSTRAINT cplt_message_seq_uk   UNIQUE (session_id, seq),
  CONSTRAINT cplt_message_sess_fk  FOREIGN KEY (session_id) REFERENCES cplt_session (session_id) ON DELETE CASCADE,
  CONSTRAINT cplt_message_role_ck  CHECK (role IN ('user', 'assistant')),
  CONSTRAINT cplt_message_outcome_ck CHECK (outcome IN ('ANSWERED', 'NO_ANSWER', 'REFUSED', 'ERROR', 'ABORTED'))
);
CREATE INDEX cplt_message_ext_ix ON cplt_message (external_message_id);

-- The context the widget sent with a question (user rows only). Standard keys as columns so they can
-- be indexed and reported on; anything else stays as JSON.
CREATE TABLE cplt_message_context (
  message_id          NUMBER         NOT NULL,
  app_mnemonic        CHAR(3)        NOT NULL,
  screen              VARCHAR2(500),
  route               VARCHAR2(500),
  page_url            VARCHAR2(1000),
  error_code          VARCHAR2(200),
  error_message       VARCHAR2(1000),
  error_source        VARCHAR2(100),
  error_job_name      VARCHAR2(200),
  error_occurred_at   TIMESTAMP WITH TIME ZONE,
  custom_json         CLOB,
  CONSTRAINT cplt_msgctx_pk   PRIMARY KEY (message_id),
  CONSTRAINT cplt_msgctx_fk   FOREIGN KEY (message_id) REFERENCES cplt_message (message_id) ON DELETE CASCADE,
  CONSTRAINT cplt_msgctx_json_ck CHECK (custom_json IS JSON)
);
CREATE INDEX cplt_msgctx_err_ix    ON cplt_message_context (app_mnemonic, error_code);
CREATE INDEX cplt_msgctx_screen_ix ON cplt_message_context (app_mnemonic, screen);

CREATE TABLE cplt_citation (
  message_id    NUMBER         NOT NULL,
  ordinal       NUMBER(3)      NOT NULL,
  title         VARCHAR2(500),
  url           VARCHAR2(2000) NOT NULL,
  source        VARCHAR2(32),                           -- runbook | confluence | jira
  concept_path  VARCHAR2(500),                          -- OKF bundle path
  CONSTRAINT cplt_citation_pk PRIMARY KEY (message_id, ordinal),
  CONSTRAINT cplt_citation_fk FOREIGN KEY (message_id) REFERENCES cplt_message (message_id) ON DELETE CASCADE
);
CREATE INDEX cplt_citation_path_ix ON cplt_citation (concept_path);

CREATE TABLE cplt_feedback (
  feedback_id  NUMBER GENERATED ALWAYS AS IDENTITY,
  message_id   NUMBER         NOT NULL,
  user_id      VARCHAR2(128)  NOT NULL,
  rating       VARCHAR2(4)    NOT NULL,
  comment_text VARCHAR2(2000),
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cplt_feedback_pk      PRIMARY KEY (feedback_id),
  CONSTRAINT cplt_feedback_uk      UNIQUE (message_id, user_id),
  CONSTRAINT cplt_feedback_msg_fk  FOREIGN KEY (message_id) REFERENCES cplt_message (message_id) ON DELETE CASCADE,
  CONSTRAINT cplt_feedback_user_fk FOREIGN KEY (user_id) REFERENCES cplt_user (user_id),
  CONSTRAINT cplt_feedback_rating_ck CHECK (rating IN ('up', 'down'))
);

-- ---------------------------------------------------------------------------
-- Long-term memory
-- ---------------------------------------------------------------------------
-- Short, durable statements distilled from conversations and recalled into later ones, e.g.
--   PREFERENCE  "Prefers AutoSys commands over screen steps"
--   ENVIRONMENT "Works on the EMEA pricing desk; valuation cut-off 18:00 London"
--   RESOLUTION  "ORA-00060 in ES_NAV_ACCRUALS on 2026-11-02 was resolved by restarting the sub-job (FUND-1423)"
--   OPEN_ISSUE  "Waiting on Pricing Ops sign-off for F12345 tolerance breach"
-- app_id NULL = applies in every app. Corrections never update in place: insert the new memory and
-- point the old one at it (superseded_by), so answers that used the old one stay explainable.
CREATE TABLE cplt_memory (
  memory_id          NUMBER GENERATED ALWAYS AS IDENTITY,
  user_id            VARCHAR2(128)  NOT NULL,
  app_id             VARCHAR2(64),
  memory_type        VARCHAR2(16)   NOT NULL,
  content            VARCHAR2(2000) NOT NULL,
  keywords           VARCHAR2(1000),                    -- error codes, job names, JIRA keys: for non-vector recall
  confidence         NUMBER(3,2)    DEFAULT 0.80 NOT NULL,
  created_by         VARCHAR2(8)    DEFAULT 'MODEL' NOT NULL,
  status             VARCHAR2(12)   DEFAULT 'ACTIVE' NOT NULL,
  superseded_by      NUMBER,
  source_session_id  VARCHAR2(36),
  source_message_id  NUMBER,
  use_count          NUMBER(9)      DEFAULT 0 NOT NULL,
  last_used_at       TIMESTAMP WITH TIME ZONE,
  expires_at         TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT cplt_memory_pk        PRIMARY KEY (memory_id),
  CONSTRAINT cplt_memory_user_fk   FOREIGN KEY (user_id) REFERENCES cplt_user (user_id),
  CONSTRAINT cplt_memory_app_fk    FOREIGN KEY (app_id)  REFERENCES cplt_app (app_id),
  CONSTRAINT cplt_memory_super_fk  FOREIGN KEY (superseded_by) REFERENCES cplt_memory (memory_id) ON DELETE SET NULL,
  CONSTRAINT cplt_memory_sess_fk   FOREIGN KEY (source_session_id) REFERENCES cplt_session (session_id) ON DELETE SET NULL,
  CONSTRAINT cplt_memory_msg_fk    FOREIGN KEY (source_message_id) REFERENCES cplt_message (message_id) ON DELETE SET NULL,
  CONSTRAINT cplt_memory_type_ck   CHECK (memory_type IN ('PREFERENCE', 'ENVIRONMENT', 'FACT', 'RESOLUTION', 'OPEN_ISSUE')),
  CONSTRAINT cplt_memory_by_ck     CHECK (created_by IN ('MODEL', 'USER', 'ADMIN')),
  CONSTRAINT cplt_memory_status_ck CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT cplt_memory_conf_ck   CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX cplt_memory_recall_ix ON cplt_memory (user_id, status, app_id);
CREATE INDEX cplt_memory_expiry_ix ON cplt_memory (expires_at);

-- Which memories were injected into which answer: audit trail and the signal for pruning unused ones.
CREATE TABLE cplt_memory_use (
  memory_id   NUMBER NOT NULL,
  message_id  NUMBER NOT NULL,
  rank_no     NUMBER(3),
  score       NUMBER,
  CONSTRAINT cplt_memory_use_pk     PRIMARY KEY (memory_id, message_id),
  CONSTRAINT cplt_memory_use_mem_fk FOREIGN KEY (memory_id)  REFERENCES cplt_memory (memory_id) ON DELETE CASCADE,
  CONSTRAINT cplt_memory_use_msg_fk FOREIGN KEY (message_id) REFERENCES cplt_message (message_id) ON DELETE CASCADE
);
CREATE INDEX cplt_memory_use_msg_ix ON cplt_memory_use (message_id);

-- ---------------------------------------------------------------------------
-- Reporting views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cplt_v_transcript AS
SELECT s.session_id, s.user_id, s.app_mnemonic, m.seq, m.role, m.content, m.created_at,
       c.screen, c.error_code, m.outcome
  FROM cplt_session s
  JOIN cplt_message m ON m.session_id = s.session_id
  LEFT JOIN cplt_message_context c ON c.message_id = m.message_id;

-- Which errors users ask about most, per application: candidates for better runbooks.
CREATE OR REPLACE VIEW cplt_v_error_hotspots AS
SELECT c.app_mnemonic, c.error_code, COUNT(*) AS questions,
       COUNT(DISTINCT s.user_id) AS users, MAX(m.created_at) AS last_asked
  FROM cplt_message_context c
  JOIN cplt_message m ON m.message_id = c.message_id
  JOIN cplt_session s ON s.session_id = m.session_id
 WHERE c.error_code IS NOT NULL
 GROUP BY c.app_mnemonic, c.error_code;
