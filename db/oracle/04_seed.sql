-- Registry rows matching config/apps.example.json. Mnemonics are sample values.
INSERT INTO cplt_app (app_id, app_mnemonic, app_name, owner_team, retention_days)
VALUES ('eagle-star', 'ESR', 'Eagle STAR', 'fund-accounting', 400);
INSERT INTO cplt_app (app_id, app_mnemonic, app_name, owner_team, retention_days)
VALUES ('ta-portal', 'TAP', 'Transfer Agency Portal', 'transfer-agency', 400);
INSERT INTO cplt_app_namespace (app_id, namespace) VALUES ('eagle-star', 'fund-accounting/eagle-star');
INSERT INTO cplt_app_namespace (app_id, namespace) VALUES ('eagle-star', 'shared');
INSERT INTO cplt_app_namespace (app_id, namespace) VALUES ('ta-portal', 'transfer-agency/ta-portal');
INSERT INTO cplt_app_namespace (app_id, namespace) VALUES ('ta-portal', 'shared');
COMMIT;
