-- Shared objects. Every tenant reads the same database, warehouse, and views;
-- isolation comes from the secure views in `serving`, not from separate objects.
USE ROLE ACCOUNTADMIN;

CREATE DATABASE IF NOT EXISTS springfield_db;
GRANT OWNERSHIP ON DATABASE springfield_db TO ROLE springfield_admin COPY CURRENT GRANTS;

-- All tenants share this warehouse. That invites noisy-neighbor behavior at
-- scale; the fix is a dedicated warehouse per tenant, which is out of scope for
-- the pilot.
CREATE WAREHOUSE IF NOT EXISTS springfield_wh
  WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;
GRANT USAGE ON WAREHOUSE springfield_wh TO ROLE springfield_admin;

-- Two schemas: `base` holds the raw tables and the entitlements map and is never
-- granted to a tenant; `serving` holds the secure views tenants actually read.
USE ROLE springfield_admin;
CREATE SCHEMA IF NOT EXISTS springfield_db.base;
CREATE SCHEMA IF NOT EXISTS springfield_db.serving;
