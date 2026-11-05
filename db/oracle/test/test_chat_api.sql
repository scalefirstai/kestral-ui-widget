-- Smoke test for the data model and cplt_chat_api. Run after 01, 02 and 04 in a scratch schema.
-- Prints PASS lines; any failed check raises and stops the script. Rolls back at the end.
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT FAILURE ROLLBACK

DECLARE

  l_a1 NUMBER; l_a2 NUMBER; l_m1 NUMBER; l_m2 NUMBER; l_m3 NUMBER; l_n NUMBER; l_s NUMBER; l_e NUMBER;
  l_v VARCHAR2(4000);
  c SYS_REFCURSOR;
  r_id NUMBER; r_type VARCHAR2(16); r_content VARCHAR2(2000); r_conf NUMBER; r_score NUMBER; r_used TIMESTAMP WITH TIME ZONE;
  l_ids VARCHAR2(200);

  PROCEDURE check_eq(p_label VARCHAR2, p_got VARCHAR2, p_want VARCHAR2) IS
  BEGIN
    IF NVL(p_got, '<null>') <> NVL(p_want, '<null>') THEN
      RAISE_APPLICATION_ERROR(-20900, 'FAIL ' || p_label || ': got [' || p_got || '] want [' || p_want || ']');
    END IF;
    DBMS_OUTPUT.PUT_LINE('PASS ' || p_label);
  END;
BEGIN
  -- 1. A turn with full context and citations creates user, session, 2 messages, context, citations.
  l_a1 := cplt_chat_api.record_turn(
    p_session_id => '11111111-1111-1111-1111-111111111111', p_user_id => 'u-test', p_app_id => 'eagle-star',
    p_app_mnemonic => 'esr', p_question => 'The NAV batch failed with ORA-00060. What do I do?',
    p_answer => 'Known issue FUND-1423. Restart ES_NAV_ACCRUALS only.',
    p_context_json => '{"appMnemonic":"ESR","appId":"eagle-star","screen":"NAV Dashboard","route":"/nav",'
                   || '"error":{"code":"ORA-00060","message":"deadlock detected","jobName":"ES_NAV_ACCRUALS","occurredAt":"2026-11-04T06:12:00.000Z"},'
                   || '"custom":{"fundId":"F12345"}}',
    p_citations_json => '[{"title":"FUND-1423","url":"https://jira.example.internal/browse/FUND-1423","source":"jira","path":"/jira/FUND-1423.md"},'
                     || '{"title":"no url"}]',
    p_host_type => 'web', p_backend => 'claude', p_external_message_id => 'msg_A1', p_model => 'claude-opus-5-5',
    p_input_tokens => 1200, p_output_tokens => 80, p_latency_ms => 2400);

  SELECT COUNT(*) INTO l_n FROM cplt_message WHERE session_id = '11111111-1111-1111-1111-111111111111';
  check_eq('two messages per turn', l_n, 2);
  SELECT app_mnemonic || '|' || title || '|' || message_count || '|' || TO_CHAR(retain_until - TRUNC(SYSDATE))
    INTO l_v FROM cplt_session WHERE session_id = '11111111-1111-1111-1111-111111111111';
  check_eq('session row', l_v, 'ESR|The NAV batch failed with ORA-00060. What do I do?|2|400');
  SELECT c.app_mnemonic || '|' || c.screen || '|' || c.error_code || '|' || c.error_job_name || '|'
         || TO_CHAR(c.error_occurred_at AT TIME ZONE 'UTC', 'HH24:MI') || '|' || JSON_VALUE(c.custom_json, '$.fundId')
    INTO l_v FROM cplt_message_context c JOIN cplt_message m ON m.message_id = c.message_id
   WHERE m.session_id = '11111111-1111-1111-1111-111111111111' AND m.seq = 1;
  check_eq('context columns', l_v, 'ESR|NAV Dashboard|ORA-00060|ES_NAV_ACCRUALS|06:12|F12345');
  SELECT COUNT(*) INTO l_n FROM cplt_citation WHERE message_id = l_a1;
  check_eq('citations without url are skipped', l_n, 1);

  -- 2. A second turn in the same session continues the sequence.
  l_a2 := cplt_chat_api.record_turn(p_session_id => '11111111-1111-1111-1111-111111111111', p_user_id => 'u-test',
    p_app_id => 'eagle-star', p_app_mnemonic => NULL, p_question => 'And if it fails again?', p_answer => 'Raise a P2.',
    p_external_message_id => 'msg_A2');
  SELECT MAX(seq) INTO l_n FROM cplt_message WHERE session_id = '11111111-1111-1111-1111-111111111111';
  check_eq('sequence continues', l_n, 4);

  -- 3. Wrong mnemonic and someone else's session are rejected.
  BEGIN
    l_n := cplt_chat_api.record_turn('22222222-2222-2222-2222-222222222222', 'u-test', 'eagle-star', 'TAP', 'q', 'a');
    check_eq('mnemonic mismatch rejected', 'accepted', 'ORA-20001');
  EXCEPTION WHEN OTHERS THEN check_eq('mnemonic mismatch rejected', SQLCODE, -20001);
  END;
  BEGIN
    l_n := cplt_chat_api.record_turn('11111111-1111-1111-1111-111111111111', 'u-other', 'eagle-star', 'ESR', 'q', 'a');
    check_eq('foreign session rejected', 'accepted', 'ORA-20002');
  EXCEPTION WHEN OTHERS THEN check_eq('foreign session rejected', SQLCODE, -20002);
  END;

  -- 4. Feedback by external message id; only the owner can rate; a second rating updates.
  cplt_chat_api.record_feedback('msg_A1', 'u-test', 'down');
  cplt_chat_api.record_feedback('msg_A1', 'u-test', 'up', 'fixed it');
  cplt_chat_api.record_feedback('msg_A1', 'u-other', 'down');
  SELECT LISTAGG(rating || ':' || comment_text, ',') INTO l_v FROM cplt_feedback WHERE message_id = l_a1;
  check_eq('feedback upsert, owner only', l_v, 'up:fixed it');

  -- 5. Memories: add, supersede, recall by keyword, record use.
  l_m1 := cplt_chat_api.add_memory('u-test', 'eagle-star', 'RESOLUTION',
            'ORA-00060 in ES_NAV_ACCRUALS was resolved by restarting the sub-job (FUND-1423)', 'ORA-00060 ES_NAV_ACCRUALS FUND-1423',
            p_source_session_id => '11111111-1111-1111-1111-111111111111', p_source_message_id => l_a1);
  l_m2 := cplt_chat_api.add_memory('u-test', NULL, 'PREFERENCE', 'Prefers AutoSys commands over screen steps');
  l_m3 := cplt_chat_api.add_memory('u-test', NULL, 'PREFERENCE', 'Prefers AutoSys commands, with the job name first',
            p_created_by => 'USER', p_supersedes => l_m2);
  SELECT status || '|' || superseded_by INTO l_v FROM cplt_memory WHERE memory_id = l_m2;
  check_eq('supersede', l_v, 'SUPERSEDED|' || l_m3);

  c := cplt_chat_api.recall_memories('u-test', 'eagle-star', 'why ORA-00060 again');
  l_ids := NULL;
  LOOP
    FETCH c INTO r_id, r_type, r_content, r_conf, r_score, r_used;
    EXIT WHEN c%NOTFOUND;
    l_ids := l_ids || r_type || ';';
  END LOOP;
  CLOSE c;
  check_eq('recall: matching resolution first, active preference, no superseded', l_ids, 'RESOLUTION;PREFERENCE;');

  c := cplt_chat_api.recall_memories('u-test', 'ta-portal', 'ORA-00060');
  l_ids := NULL;
  LOOP
    FETCH c INTO r_id, r_type, r_content, r_conf, r_score, r_used;
    EXIT WHEN c%NOTFOUND;
    l_ids := l_ids || r_type || ';';
  END LOOP;
  CLOSE c;
  check_eq('recall is scoped by app (cross-app preference only)', l_ids, 'PREFERENCE;');

  l_n := cplt_chat_api.record_turn('11111111-1111-1111-1111-111111111111', 'u-test', 'eagle-star', 'ESR', 'q3', 'a3',
           p_used_memories_json => '[{"memoryId":' || l_m1 || ',"score":4.8},{"memoryId":999999}]');
  SELECT use_count INTO l_n FROM cplt_memory WHERE memory_id = l_m1;
  check_eq('memory use recorded, unknown id ignored', l_n, 1);

  -- 6. Opt-out stops new memories.
  UPDATE cplt_user SET memory_opt_out = 'Y' WHERE user_id = 'u-test';
  check_eq('opt-out blocks memory', NVL(TO_CHAR(cplt_chat_api.add_memory('u-test', NULL, 'FACT', 'x')), 'null'), 'null');
  UPDATE cplt_user SET memory_opt_out = 'N' WHERE user_id = 'u-test';

  -- 7. Summaries.
  cplt_chat_api.save_session_summary('11111111-1111-1111-1111-111111111111', 'NAV accruals deadlock; restarted per FUND-1423.');
  c := cplt_chat_api.recent_summaries('u-test', 'eagle-star');
  DECLARE sid VARCHAR2(36); t VARCHAR2(200); s CLOB; ts TIMESTAMP WITH TIME ZONE; BEGIN
    FETCH c INTO sid, t, s, ts; CLOSE c;
    check_eq('recent summary', DBMS_LOB.SUBSTR(s, 20, 1), 'NAV accruals deadloc');
  END;

  -- 8. Retention: expired sessions go (with children), legal hold stays, memories keep their text.
  l_n := cplt_chat_api.record_turn('33333333-3333-3333-3333-333333333333', 'u-test', 'eagle-star', 'ESR', 'old q', 'old a');
  UPDATE cplt_session SET retain_until = TRUNC(SYSDATE) - 1 WHERE session_id IN ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
  UPDATE cplt_session SET legal_hold = 'Y' WHERE session_id = '33333333-3333-3333-3333-333333333333';
  cplt_chat_api.purge_expired(l_s, l_e);
  check_eq('purge deletes expired, keeps legal hold', l_s, 1);
  SELECT COUNT(*) INTO l_n FROM cplt_message WHERE session_id = '11111111-1111-1111-1111-111111111111';
  check_eq('messages cascade', l_n, 0);
  SELECT status || '|' || NVL(source_session_id, 'null') || '|' || NVL(TO_CHAR(source_message_id), 'null') INTO l_v FROM cplt_memory WHERE memory_id = l_m1;
  check_eq('memory survives session purge', l_v, 'ACTIVE|null|null');

  -- 9. Forget user: memories gone, held session kept, user kept because of it.
  cplt_chat_api.forget_user('u-test');
  SELECT COUNT(*) INTO l_n FROM cplt_memory WHERE user_id = 'u-test';
  check_eq('forget removes memories', l_n, 0);
  SELECT COUNT(*) INTO l_n FROM cplt_session WHERE user_id = 'u-test';
  check_eq('forget keeps legal-hold sessions', l_n, 1);
  SELECT memory_opt_out INTO l_v FROM cplt_user WHERE user_id = 'u-test';
  check_eq('forget opts the user out', l_v, 'Y');

  -- 10. Reporting view.
  SELECT COUNT(*) INTO l_n FROM cplt_v_error_hotspots;
  DBMS_OUTPUT.PUT_LINE('PASS hotspot view queryable (' || l_n || ' rows)');
END;
/
ROLLBACK;
