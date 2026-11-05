-- Write/read API for the gateway. Grant the gateway's DB user EXECUTE on this package only,
-- not table privileges. Oracle 19c+.
CREATE OR REPLACE PACKAGE cplt_chat_api AUTHID DEFINER AS

  -- One question + answer. Creates the user and session on first use. p_context_json is the gateway's
  -- normalised context: {"appMnemonic","screen","route","url","error":{code,message,source,occurredAt,jobName},"custom":{}}.
  -- p_citations_json: [{"title","url","source","path"}]. p_used_memories_json: [{"memoryId":1,"score":0.83}].
  -- Returns the assistant message_id.
  FUNCTION record_turn(
    p_session_id          IN VARCHAR2,
    p_user_id             IN VARCHAR2,
    p_app_id              IN VARCHAR2,
    p_app_mnemonic        IN VARCHAR2,
    p_question            IN CLOB,
    p_answer              IN CLOB,
    p_context_json        IN CLOB     DEFAULT NULL,
    p_citations_json      IN CLOB     DEFAULT NULL,
    p_used_memories_json  IN CLOB     DEFAULT NULL,
    p_namespace           IN VARCHAR2 DEFAULT NULL,
    p_host_type           IN VARCHAR2 DEFAULT NULL,
    p_client_version      IN VARCHAR2 DEFAULT NULL,
    p_backend             IN VARCHAR2 DEFAULT NULL,
    p_external_message_id IN VARCHAR2 DEFAULT NULL,
    p_model               IN VARCHAR2 DEFAULT NULL,
    p_outcome             IN VARCHAR2 DEFAULT 'ANSWERED',
    p_input_tokens        IN NUMBER   DEFAULT NULL,
    p_output_tokens       IN NUMBER   DEFAULT NULL,
    p_latency_ms          IN NUMBER   DEFAULT NULL
  ) RETURN NUMBER;

  PROCEDURE record_feedback(p_external_message_id IN VARCHAR2, p_user_id IN VARCHAR2,
                            p_rating IN VARCHAR2, p_comment IN VARCHAR2 DEFAULT NULL);

  PROCEDURE save_session_summary(p_session_id IN VARCHAR2, p_summary IN CLOB);

  -- Returns the new memory_id, or NULL when the user opted out or the app has memory disabled.
  -- p_supersedes marks an older memory as replaced by this one.
  FUNCTION add_memory(
    p_user_id           IN VARCHAR2,
    p_app_id            IN VARCHAR2,              -- NULL = applies in every app
    p_memory_type       IN VARCHAR2,
    p_content           IN VARCHAR2,
    p_keywords          IN VARCHAR2 DEFAULT NULL,
    p_confidence        IN NUMBER   DEFAULT 0.80,
    p_created_by        IN VARCHAR2 DEFAULT 'MODEL',
    p_source_session_id IN VARCHAR2 DEFAULT NULL,
    p_source_message_id IN NUMBER   DEFAULT NULL,
    p_expires_at        IN TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_supersedes        IN NUMBER   DEFAULT NULL
  ) RETURN NUMBER;

  -- User asked to forget something, or a reviewer rejected it.
  PROCEDURE reject_memory(p_memory_id IN NUMBER, p_user_id IN VARCHAR2);

  -- Keyword recall (works on 19c). p_terms: space-separated error codes, job names, screen words.
  -- Columns: memory_id, memory_type, content, confidence, score, last_used_at.
  FUNCTION recall_memories(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2,
                           p_terms IN VARCHAR2 DEFAULT NULL, p_limit IN NUMBER DEFAULT 8) RETURN SYS_REFCURSOR;

  -- Last few session summaries for this user in this app, newest first.
  FUNCTION recent_summaries(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_limit IN NUMBER DEFAULT 3) RETURN SYS_REFCURSOR;

  -- Nightly: delete sessions past retain_until (unless on legal hold) and expire memories.
  PROCEDURE purge_expired(p_sessions_deleted OUT NUMBER, p_memories_expired OUT NUMBER);

  -- Right to erasure: removes the user's sessions (except those on legal hold), memories and feedback.
  PROCEDURE forget_user(p_user_id IN VARCHAR2);

END cplt_chat_api;
/

CREATE OR REPLACE PACKAGE BODY cplt_chat_api AS

  FUNCTION iso_ts(p VARCHAR2) RETURN TIMESTAMP WITH TIME ZONE IS
    s VARCHAR2(64) := REGEXP_REPLACE(TRIM(p), 'Z$', '+00:00');
  BEGIN
    IF s IS NULL THEN RETURN NULL; END IF;
    BEGIN
      RETURN TO_TIMESTAMP_TZ(s, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM');
    EXCEPTION WHEN OTHERS THEN
      RETURN TO_TIMESTAMP_TZ(s, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
    END;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL; -- a malformed timestamp from a host page must not lose the turn
  END;

  PROCEDURE touch_user(p_user_id VARCHAR2) IS
  BEGIN
    MERGE INTO cplt_user u
    USING (SELECT p_user_id AS user_id FROM dual) x ON (u.user_id = x.user_id)
    WHEN MATCHED THEN UPDATE SET u.last_seen_at = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (user_id) VALUES (x.user_id);
  END;

  FUNCTION record_turn(
    p_session_id          IN VARCHAR2,
    p_user_id             IN VARCHAR2,
    p_app_id              IN VARCHAR2,
    p_app_mnemonic        IN VARCHAR2,
    p_question            IN CLOB,
    p_answer              IN CLOB,
    p_context_json        IN CLOB     DEFAULT NULL,
    p_citations_json      IN CLOB     DEFAULT NULL,
    p_used_memories_json  IN CLOB     DEFAULT NULL,
    p_namespace           IN VARCHAR2 DEFAULT NULL,
    p_host_type           IN VARCHAR2 DEFAULT NULL,
    p_client_version      IN VARCHAR2 DEFAULT NULL,
    p_backend             IN VARCHAR2 DEFAULT NULL,
    p_external_message_id IN VARCHAR2 DEFAULT NULL,
    p_model               IN VARCHAR2 DEFAULT NULL,
    p_outcome             IN VARCHAR2 DEFAULT 'ANSWERED',
    p_input_tokens        IN NUMBER   DEFAULT NULL,
    p_output_tokens       IN NUMBER   DEFAULT NULL,
    p_latency_ms          IN NUMBER   DEFAULT NULL
  ) RETURN NUMBER IS
    l_mnemonic   cplt_app.app_mnemonic%TYPE;
    l_retention  cplt_app.retention_days%TYPE;
    l_owner      cplt_session.user_id%TYPE;
    l_count      cplt_session.message_count%TYPE;
    l_q_id       NUMBER;
    l_a_id       NUMBER;
    l_err_at     TIMESTAMP WITH TIME ZONE;
    l_v_err_at   VARCHAR2(64);
  BEGIN
    SELECT app_mnemonic, retention_days INTO l_mnemonic, l_retention FROM cplt_app WHERE app_id = p_app_id;
    IF p_app_mnemonic IS NOT NULL AND UPPER(p_app_mnemonic) <> l_mnemonic THEN
      RAISE_APPLICATION_ERROR(-20001, 'appMnemonic ' || p_app_mnemonic || ' does not match ' || p_app_id);
    END IF;
    touch_user(p_user_id);

    BEGIN
      INSERT INTO cplt_session (session_id, user_id, app_id, app_mnemonic, namespace, host_type, client_version,
                                backend, title, retain_until)
      VALUES (p_session_id, p_user_id, p_app_id, l_mnemonic, p_namespace, p_host_type, p_client_version,
              p_backend, SUBSTR(DBMS_LOB.SUBSTR(p_question, 200, 1), 1, 200), TRUNC(SYSDATE) + l_retention);
    EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL;
    END;

    -- Lock the session so concurrent turns get distinct seq numbers.
    SELECT user_id, message_count INTO l_owner, l_count FROM cplt_session WHERE session_id = p_session_id FOR UPDATE;
    IF l_owner <> p_user_id THEN
      RAISE_APPLICATION_ERROR(-20002, 'session ' || p_session_id || ' belongs to another user');
    END IF;

    INSERT INTO cplt_message (session_id, seq, role, content)
    VALUES (p_session_id, l_count + 1, 'user', p_question)
    RETURNING message_id INTO l_q_id;

    IF p_context_json IS NOT NULL THEN
      -- iso_ts is package-private, so it cannot be called inside the INSERT ... SELECT.
      SELECT JSON_VALUE(p_context_json, '$.error.occurredAt' RETURNING VARCHAR2(64) TRUNCATE NULL ON ERROR)
        INTO l_v_err_at FROM dual;
      l_err_at := iso_ts(l_v_err_at);
      INSERT INTO cplt_message_context (message_id, app_mnemonic, screen, route, page_url, error_code, error_message,
                                        error_source, error_job_name, error_occurred_at, custom_json)
      SELECT l_q_id, l_mnemonic,
             JSON_VALUE(p_context_json, '$.screen' RETURNING VARCHAR2(500) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.route' RETURNING VARCHAR2(500) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.url' RETURNING VARCHAR2(1000) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.error.code' RETURNING VARCHAR2(200) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.error.message' RETURNING VARCHAR2(1000) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.error.source' RETURNING VARCHAR2(100) TRUNCATE NULL ON ERROR),
             JSON_VALUE(p_context_json, '$.error.jobName' RETURNING VARCHAR2(200) TRUNCATE NULL ON ERROR),
             l_err_at,
             JSON_QUERY(p_context_json, '$.custom' RETURNING CLOB NULL ON ERROR)
        FROM dual;
    END IF;

    INSERT INTO cplt_message (session_id, seq, role, content, external_message_id, model, outcome,
                              input_tokens, output_tokens, latency_ms)
    VALUES (p_session_id, l_count + 2, 'assistant', NVL(p_answer, EMPTY_CLOB()), p_external_message_id, p_model,
            p_outcome, p_input_tokens, p_output_tokens, p_latency_ms)
    RETURNING message_id INTO l_a_id;

    IF p_citations_json IS NOT NULL THEN
      INSERT INTO cplt_citation (message_id, ordinal, title, url, source, concept_path)
      SELECT l_a_id, j.ord, j.title, j.url, j.source, j.path
        FROM JSON_TABLE(p_citations_json, '$[*]' COLUMNS (
               ord    FOR ORDINALITY,
               title  VARCHAR2(500)  TRUNCATE PATH '$.title',
               url    VARCHAR2(2000) TRUNCATE PATH '$.url',
               source VARCHAR2(32)   TRUNCATE PATH '$.source',
               path   VARCHAR2(500)  TRUNCATE PATH '$.path')) j
       WHERE j.url IS NOT NULL;
    END IF;

    IF p_used_memories_json IS NOT NULL THEN
      INSERT INTO cplt_memory_use (memory_id, message_id, rank_no, score)
      SELECT j.memory_id, l_a_id, j.ord, j.score
        FROM JSON_TABLE(p_used_memories_json, '$[*]' COLUMNS (
               ord       FOR ORDINALITY,
               memory_id NUMBER PATH '$.memoryId',
               score     NUMBER PATH '$.score')) j
       WHERE j.memory_id IN (SELECT memory_id FROM cplt_memory WHERE user_id = p_user_id);
      UPDATE cplt_memory
         SET use_count = use_count + 1, last_used_at = SYSTIMESTAMP
       WHERE memory_id IN (SELECT memory_id FROM cplt_memory_use WHERE message_id = l_a_id);
    END IF;

    UPDATE cplt_session
       SET message_count = l_count + 2, last_activity_at = SYSTIMESTAMP
     WHERE session_id = p_session_id;
    RETURN l_a_id;
  END record_turn;

  PROCEDURE record_feedback(p_external_message_id IN VARCHAR2, p_user_id IN VARCHAR2,
                            p_rating IN VARCHAR2, p_comment IN VARCHAR2 DEFAULT NULL) IS
    l_msg NUMBER;
  BEGIN
    -- Only the session owner can rate an answer.
    SELECT m.message_id INTO l_msg
      FROM cplt_message m JOIN cplt_session s ON s.session_id = m.session_id
     WHERE m.external_message_id = p_external_message_id AND m.role = 'assistant' AND s.user_id = p_user_id
     FETCH FIRST 1 ROW ONLY;
    MERGE INTO cplt_feedback f
    USING (SELECT l_msg AS message_id, p_user_id AS user_id FROM dual) x
       ON (f.message_id = x.message_id AND f.user_id = x.user_id)
    WHEN MATCHED THEN UPDATE SET f.rating = p_rating, f.comment_text = p_comment, f.created_at = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (message_id, user_id, rating, comment_text) VALUES (x.message_id, x.user_id, p_rating, p_comment);
  EXCEPTION WHEN NO_DATA_FOUND THEN
    NULL; -- unknown or foreign message id: ignore, as the gateway's /v1/feedback does
  END record_feedback;

  PROCEDURE save_session_summary(p_session_id IN VARCHAR2, p_summary IN CLOB) IS
  BEGIN
    UPDATE cplt_session SET summary = p_summary, summary_updated_at = SYSTIMESTAMP WHERE session_id = p_session_id;
  END save_session_summary;

  FUNCTION add_memory(
    p_user_id           IN VARCHAR2,
    p_app_id            IN VARCHAR2,
    p_memory_type       IN VARCHAR2,
    p_content           IN VARCHAR2,
    p_keywords          IN VARCHAR2 DEFAULT NULL,
    p_confidence        IN NUMBER   DEFAULT 0.80,
    p_created_by        IN VARCHAR2 DEFAULT 'MODEL',
    p_source_session_id IN VARCHAR2 DEFAULT NULL,
    p_source_message_id IN NUMBER   DEFAULT NULL,
    p_expires_at        IN TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_supersedes        IN NUMBER   DEFAULT NULL
  ) RETURN NUMBER IS
    l_opt_out  cplt_user.memory_opt_out%TYPE;
    l_enabled  cplt_app.memory_enabled%TYPE := 'Y';
    l_id       NUMBER;
  BEGIN
    touch_user(p_user_id);
    SELECT memory_opt_out INTO l_opt_out FROM cplt_user WHERE user_id = p_user_id;
    IF p_app_id IS NOT NULL THEN
      SELECT memory_enabled INTO l_enabled FROM cplt_app WHERE app_id = p_app_id;
    END IF;
    IF l_opt_out = 'Y' OR l_enabled = 'N' THEN
      RETURN NULL;
    END IF;

    INSERT INTO cplt_memory (user_id, app_id, memory_type, content, keywords, confidence, created_by,
                             source_session_id, source_message_id, expires_at)
    VALUES (p_user_id, p_app_id, p_memory_type, p_content, LOWER(p_keywords), p_confidence, p_created_by,
            p_source_session_id, p_source_message_id, p_expires_at)
    RETURNING memory_id INTO l_id;

    IF p_supersedes IS NOT NULL THEN
      UPDATE cplt_memory
         SET status = 'SUPERSEDED', superseded_by = l_id, updated_at = SYSTIMESTAMP
       WHERE memory_id = p_supersedes AND user_id = p_user_id AND status = 'ACTIVE';
    END IF;
    RETURN l_id;
  END add_memory;

  PROCEDURE reject_memory(p_memory_id IN NUMBER, p_user_id IN VARCHAR2) IS
  BEGIN
    UPDATE cplt_memory SET status = 'REJECTED', updated_at = SYSTIMESTAMP
     WHERE memory_id = p_memory_id AND user_id = p_user_id;
  END reject_memory;

  FUNCTION recall_memories(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2,
                           p_terms IN VARCHAR2 DEFAULT NULL, p_limit IN NUMBER DEFAULT 8) RETURN SYS_REFCURSOR IS
    c SYS_REFCURSOR;
  BEGIN
    OPEN c FOR
      WITH terms AS (
        SELECT DISTINCT LOWER(REGEXP_SUBSTR(p_terms, '[^[:space:],;]+', 1, LEVEL)) AS term
          FROM dual
       CONNECT BY REGEXP_SUBSTR(p_terms, '[^[:space:],;]+', 1, LEVEL) IS NOT NULL
      ),
      scored AS (
        SELECT m.memory_id, m.memory_type, m.content, m.confidence, m.last_used_at, m.created_at,
               (SELECT COUNT(*) FROM terms t
                 WHERE LENGTH(t.term) > 2
                   AND (INSTR(m.keywords, t.term) > 0 OR INSTR(LOWER(m.content), t.term) > 0)) AS hits,
               CASE WHEN m.app_id = p_app_id THEN 1 ELSE 0 END AS same_app
          FROM cplt_memory m
         WHERE m.user_id = p_user_id
           AND m.status = 'ACTIVE'
           AND (m.app_id = p_app_id OR m.app_id IS NULL)
           AND (m.expires_at IS NULL OR m.expires_at > SYSTIMESTAMP)
      )
      SELECT memory_id, memory_type, content, confidence,
             ROUND(hits * 2 + same_app + confidence
                   + CASE memory_type WHEN 'PREFERENCE' THEN 0.5 WHEN 'ENVIRONMENT' THEN 0.5 ELSE 0 END, 2) AS score,
             last_used_at
        FROM scored
       -- Preferences and environment always apply; everything else only when it matches the question.
       WHERE hits > 0 OR memory_type IN ('PREFERENCE', 'ENVIRONMENT')
       ORDER BY score DESC, created_at DESC
       FETCH FIRST p_limit ROWS ONLY;
    RETURN c;
  END recall_memories;

  FUNCTION recent_summaries(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_limit IN NUMBER DEFAULT 3) RETURN SYS_REFCURSOR IS
    c SYS_REFCURSOR;
  BEGIN
    OPEN c FOR
      SELECT session_id, title, summary, last_activity_at
        FROM cplt_session
       WHERE user_id = p_user_id AND app_id = p_app_id AND summary IS NOT NULL
       ORDER BY last_activity_at DESC
       FETCH FIRST p_limit ROWS ONLY;
    RETURN c;
  END recent_summaries;

  PROCEDURE purge_expired(p_sessions_deleted OUT NUMBER, p_memories_expired OUT NUMBER) IS
  BEGIN
    DELETE FROM cplt_session WHERE retain_until < TRUNC(SYSDATE) AND legal_hold = 'N';
    p_sessions_deleted := SQL%ROWCOUNT;      -- messages, context, citations, feedback cascade
    UPDATE cplt_memory SET status = 'EXPIRED', updated_at = SYSTIMESTAMP
     WHERE status = 'ACTIVE' AND expires_at < SYSTIMESTAMP;
    p_memories_expired := SQL%ROWCOUNT;
  END purge_expired;

  PROCEDURE forget_user(p_user_id IN VARCHAR2) IS
  BEGIN
    DELETE FROM cplt_memory WHERE user_id = p_user_id;
    DELETE FROM cplt_feedback WHERE user_id = p_user_id
       AND message_id NOT IN (SELECT m.message_id FROM cplt_message m JOIN cplt_session s ON s.session_id = m.session_id
                               WHERE s.legal_hold = 'Y');
    DELETE FROM cplt_session WHERE user_id = p_user_id AND legal_hold = 'N';
    UPDATE cplt_user SET memory_opt_out = 'Y', display_name = NULL WHERE user_id = p_user_id;
    DELETE FROM cplt_user u WHERE u.user_id = p_user_id
       AND NOT EXISTS (SELECT 1 FROM cplt_session s WHERE s.user_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM cplt_feedback f WHERE f.user_id = u.user_id);
  END forget_user;

END cplt_chat_api;
/

-- Nightly retention job (run once as the schema owner):
-- BEGIN
--   DBMS_SCHEDULER.CREATE_JOB(
--     job_name        => 'CPLT_PURGE_EXPIRED',
--     job_type        => 'PLSQL_BLOCK',
--     job_action      => 'DECLARE s NUMBER; m NUMBER; BEGIN cplt_chat_api.purge_expired(s, m); COMMIT; END;',
--     repeat_interval => 'FREQ=DAILY;BYHOUR=2',
--     enabled         => TRUE);
-- END;
-- /
