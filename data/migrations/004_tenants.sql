-- One service user and one role per tenant.
--
-- The service user is the identity an embedded Streamlit session runs as. Human
-- users at the tenant authenticate against the IdP, whose token asserts
-- snowflake_user = <this user>; Snowflake's External OAuth integration resolves
-- that claim to LOGIN_NAME. No Snowflake identity is provisioned per end user.
--
-- The single role is also the service user's DEFAULT_ROLE, so the session lands
-- on the right role whether or not the embed path honors the token's `scp`
-- claim. To add access levels within a tenant later, create a second role, grant
-- it to the same service user, add an entitlements row, and let `scp` select
-- between them per request.
USE ROLE ACCOUNTADMIN;
USE WAREHOUSE springfield_wh;

CREATE ROLE IF NOT EXISTS tenant_duff;
CREATE ROLE IF NOT EXISTS tenant_krusty;

CREATE USER IF NOT EXISTS tenant_duff_svc   TYPE = SERVICE LOGIN_NAME = 'TENANT_DUFF_SVC'
  DEFAULT_ROLE = tenant_duff   DEFAULT_WAREHOUSE = springfield_wh DEFAULT_NAMESPACE = 'SPRINGFIELD_DB.SERVING';
CREATE USER IF NOT EXISTS tenant_krusty_svc TYPE = SERVICE LOGIN_NAME = 'TENANT_KRUSTY_SVC'
  DEFAULT_ROLE = tenant_krusty DEFAULT_WAREHOUSE = springfield_wh DEFAULT_NAMESPACE = 'SPRINGFIELD_DB.SERVING';

GRANT ROLE tenant_duff   TO USER tenant_duff_svc;
GRANT ROLE tenant_krusty TO USER tenant_krusty_svc;

-- Demo affordance, not a production pattern: also grant both tenant roles to
-- whoever ran the migration, so `just verify` can assume each role in turn and
-- prove isolation without going through the app. In a real deployment only a
-- tenant's own service user holds that tenant's role. Note that the role owning
-- this data model (springfield_admin) has no entitlements row, so it reads nothing
-- through `serving` at all.
SET grant_duff   = 'GRANT ROLE tenant_duff TO USER "'   || CURRENT_USER() || '"';
SET grant_krusty = 'GRANT ROLE tenant_krusty TO USER "' || CURRENT_USER() || '"';
EXECUTE IMMEDIATE $grant_duff;
EXECUTE IMMEDIATE $grant_krusty;

-- Identical grants to both roles, scoped to `serving` and the warehouse. Neither
-- role can reach `base`, so the only path to the data applies the entitlements
-- join. The secure views are what differentiate the two roles.
EXECUTE IMMEDIATE $$
DECLARE
  roles ARRAY := ARRAY_CONSTRUCT('tenant_duff', 'tenant_krusty');
BEGIN
  FOR i IN 0 TO ARRAY_SIZE(:roles)-1 DO
    LET r STRING := GET(:roles, :i)::STRING;
    EXECUTE IMMEDIATE 'GRANT USAGE ON DATABASE springfield_db TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT USAGE ON SCHEMA springfield_db.serving TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT SELECT ON ALL VIEWS IN SCHEMA springfield_db.serving TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT SELECT ON FUTURE VIEWS IN SCHEMA springfield_db.serving TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT USAGE ON WAREHOUSE springfield_wh TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT DATABASE ROLE SNOWFLAKE.CORTEX_ANALYST_USER TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE ' || :r;
    EXECUTE IMMEDIATE 'GRANT DATABASE ROLE SNOWFLAKE.CORTEX_REST_API_USER TO ROLE ' || :r;
  END FOR;
END;
$$;
