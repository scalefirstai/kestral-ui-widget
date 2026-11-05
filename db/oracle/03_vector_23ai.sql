-- Optional, Oracle Database 23ai only: semantic recall of memories and past sessions with AI Vector Search.
-- Run after 01 and 02. 19c deployments skip this file and use cplt_chat_api.recall_memories (keywords).
--
-- Dimension must match the embedding model. 1024 fits common models (e.g. Cohere embed v3, BGE-large);
-- change it before running if Eliza's embedding endpoint returns a different size. Embeddings are
-- computed outside the database (Eliza / the gateway) and written with the rows, or in-database with
-- DBMS_VECTOR.UTL_TO_EMBEDDING and an imported ONNX model.

ALTER TABLE cplt_memory  ADD (embedding VECTOR(1024, FLOAT32), embedding_model VARCHAR2(64));
ALTER TABLE cplt_session ADD (summary_embedding VECTOR(1024, FLOAT32), embedding_model VARCHAR2(64));

-- IVF index: no vector memory pool needed (HNSW would need VECTOR_MEMORY_SIZE set on the instance).
CREATE VECTOR INDEX cplt_memory_vix ON cplt_memory (embedding)
  ORGANIZATION NEIGHBOR PARTITIONS DISTANCE COSINE WITH TARGET ACCURACY 95;

CREATE VECTOR INDEX cplt_session_vix ON cplt_session (summary_embedding)
  ORGANIZATION NEIGHBOR PARTITIONS DISTANCE COSINE WITH TARGET ACCURACY 95;

CREATE OR REPLACE PACKAGE cplt_vector_api AUTHID DEFINER AS
  PROCEDURE set_memory_embedding(p_memory_id IN NUMBER, p_embedding IN VECTOR, p_model IN VARCHAR2);
  PROCEDURE set_summary_embedding(p_session_id IN VARCHAR2, p_embedding IN VECTOR, p_model IN VARCHAR2);

  -- Nearest active memories for this user in this app (plus cross-app ones) to the question embedding.
  -- Columns: memory_id, memory_type, content, confidence, distance.
  FUNCTION recall_semantic(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_query IN VECTOR,
                           p_limit IN NUMBER DEFAULT 8, p_max_distance IN NUMBER DEFAULT 0.6) RETURN SYS_REFCURSOR;

  -- Past sessions by this user in this app that were about something similar.
  FUNCTION similar_sessions(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_query IN VECTOR,
                            p_limit IN NUMBER DEFAULT 3) RETURN SYS_REFCURSOR;
END cplt_vector_api;
/

CREATE OR REPLACE PACKAGE BODY cplt_vector_api AS
  PROCEDURE set_memory_embedding(p_memory_id IN NUMBER, p_embedding IN VECTOR, p_model IN VARCHAR2) IS
  BEGIN
    UPDATE cplt_memory SET embedding = p_embedding, embedding_model = p_model, updated_at = SYSTIMESTAMP
     WHERE memory_id = p_memory_id;
  END;

  PROCEDURE set_summary_embedding(p_session_id IN VARCHAR2, p_embedding IN VECTOR, p_model IN VARCHAR2) IS
  BEGIN
    UPDATE cplt_session SET summary_embedding = p_embedding, embedding_model = p_model
     WHERE session_id = p_session_id;
  END;

  FUNCTION recall_semantic(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_query IN VECTOR,
                           p_limit IN NUMBER DEFAULT 8, p_max_distance IN NUMBER DEFAULT 0.6) RETURN SYS_REFCURSOR IS
    c SYS_REFCURSOR;
  BEGIN
    OPEN c FOR
      SELECT * FROM (
        SELECT m.memory_id, m.memory_type, m.content, m.confidence,
               VECTOR_DISTANCE(m.embedding, p_query, COSINE) AS distance
          FROM cplt_memory m
         WHERE m.user_id = p_user_id
           AND m.status = 'ACTIVE'
           AND (m.app_id = p_app_id OR m.app_id IS NULL)
           AND (m.expires_at IS NULL OR m.expires_at > SYSTIMESTAMP)
           AND m.embedding IS NOT NULL
         ORDER BY distance
         FETCH APPROX FIRST p_limit ROWS ONLY WITH TARGET ACCURACY 90)
       WHERE distance <= p_max_distance;
    RETURN c;
  END;

  FUNCTION similar_sessions(p_user_id IN VARCHAR2, p_app_id IN VARCHAR2, p_query IN VECTOR,
                            p_limit IN NUMBER DEFAULT 3) RETURN SYS_REFCURSOR IS
    c SYS_REFCURSOR;
  BEGIN
    OPEN c FOR
      SELECT s.session_id, s.title, s.summary, s.last_activity_at,
             VECTOR_DISTANCE(s.summary_embedding, p_query, COSINE) AS distance
        FROM cplt_session s
       WHERE s.user_id = p_user_id AND s.app_id = p_app_id AND s.summary_embedding IS NOT NULL
       ORDER BY distance
       FETCH APPROX FIRST p_limit ROWS ONLY WITH TARGET ACCURACY 90;
    RETURN c;
  END;
END cplt_vector_api;
/

-- The ALTER TABLEs above invalidate dependants; recompile so the schema is clean after install.
ALTER PACKAGE cplt_chat_api COMPILE BODY;
ALTER VIEW cplt_v_transcript COMPILE;
ALTER VIEW cplt_v_error_hotspots COMPILE;
