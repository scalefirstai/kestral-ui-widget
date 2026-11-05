-- Smoke test for 03_vector_23ai.sql (Oracle 23ai). Uses synthetic 1024-dim vectors. Rolls back.
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
DECLARE
  l_near NUMBER; l_far NUMBER; l_n NUMBER;
  c SYS_REFCURSOR;
  r_id NUMBER; r_type VARCHAR2(16); r_content VARCHAR2(2000); r_conf NUMBER; r_dist NUMBER;
  l_ids VARCHAR2(200);

  -- Unit-ish vector pointing mostly along dimension p_axis.
  FUNCTION vec(p_axis PLS_INTEGER) RETURN VECTOR IS
    s CLOB := '[';
  BEGIN
    FOR i IN 1 .. 1024 LOOP
      s := s || CASE WHEN i = p_axis THEN '1' ELSE '0.001' END || CASE WHEN i < 1024 THEN ',' END;
    END LOOP;
    RETURN TO_VECTOR(s || ']', 1024, FLOAT32);
  END;
BEGIN
  l_near := cplt_chat_api.add_memory('u-vec', 'eagle-star', 'RESOLUTION', 'Deadlock in accruals: restart the sub-job');
  l_far  := cplt_chat_api.add_memory('u-vec', 'eagle-star', 'FACT', 'Team lunch is on Fridays');
  cplt_vector_api.set_memory_embedding(l_near, vec(1), 'test');
  cplt_vector_api.set_memory_embedding(l_far, vec(500), 'test');

  c := cplt_vector_api.recall_semantic('u-vec', 'eagle-star', vec(1), 5, 0.6);
  LOOP
    FETCH c INTO r_id, r_type, r_content, r_conf, r_dist;
    EXIT WHEN c%NOTFOUND;
    l_ids := l_ids || CASE r_id WHEN l_near THEN 'near' WHEN l_far THEN 'far' END || ';';
  END LOOP;
  CLOSE c;
  IF NVL(l_ids, '-') <> 'near;' THEN
    RAISE_APPLICATION_ERROR(-20900, 'FAIL recall_semantic: got ' || l_ids);
  END IF;
  DBMS_OUTPUT.PUT_LINE('PASS recall_semantic returns the close memory and drops the distant one');
END;
/
ROLLBACK;
