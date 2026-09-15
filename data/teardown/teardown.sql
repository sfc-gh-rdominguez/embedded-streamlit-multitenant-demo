USE ROLE ACCOUNTADMIN;

DROP ROLE IF EXISTS springfield_admin;
DROP DATABASE IF EXISTS springfield_db;
DROP WAREHOUSE IF EXISTS springfield_wh;
DROP ROLE IF EXISTS tenant_duff;
DROP ROLE IF EXISTS tenant_krusty;

DROP USER IF EXISTS tenant_duff_svc;
DROP USER IF EXISTS tenant_krusty_svc;

DROP SECURITY INTEGRATION IF EXISTS springfield_keycloak;
