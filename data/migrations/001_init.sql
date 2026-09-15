-- Creates the role that owns the SPRINGFIELD demo data model. Uses CURRENT_USER() so the
-- migration is portable across accounts without hardcoding a grantee.
USE ROLE ACCOUNTADMIN;

CREATE ROLE IF NOT EXISTS springfield_admin;
GRANT ROLE springfield_admin TO ROLE SYSADMIN;

SET grant_stmt = 'GRANT ROLE springfield_admin TO USER "' || CURRENT_USER() || '"';
EXECUTE IMMEDIATE $grant_stmt;
