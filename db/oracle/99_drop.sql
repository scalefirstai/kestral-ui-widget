-- Removes every copilot object. Development only.
BEGIN
  FOR o IN (SELECT object_name, object_type FROM user_objects
             WHERE object_name LIKE 'CPLT\_%' ESCAPE '\' AND object_type IN ('PACKAGE', 'VIEW')) LOOP
    EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' ' || o.object_name;
  END LOOP;
  FOR t IN (SELECT table_name FROM user_tables WHERE table_name LIKE 'CPLT\_%' ESCAPE '\') LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/
