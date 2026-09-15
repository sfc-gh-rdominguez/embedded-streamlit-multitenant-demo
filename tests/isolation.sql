-- Proves tenant isolation from the data layer alone, with no application in the
-- path. Run with: just verify <connection>
--
-- Every check runs the same statement under a different role. If any of these
-- fail, nothing downstream (app, embed, Cortex Analyst) can be trusted.
--
-- Secondary roles are disabled first, and that is not incidental. An operator
-- running this holds other roles, and with secondary roles active a check against
-- `base` measures the operator's own privileges rather than the tenant role's.
-- A tenant's service user holds exactly one role, so NONE is the faithful
-- simulation. Worth knowing: secondary roles never widen what the secure views
-- return, because the entitlements join keys on CURRENT_ROLE(), which is the
-- primary role alone. What they can widen is direct access to `base`.
USE ROLE tenant_duff;
USE SECONDARY ROLES NONE;
USE WAREHOUSE springfield_wh;
USE SCHEMA springfield_db.serving;

-- 0. Confirm the harness is honest: one primary role, no secondary roles.
SELECT 'session context' AS check_name, CURRENT_ROLE() AS primary_role,
       CURRENT_SECONDARY_ROLES() AS secondary_roles;

-- 1. Each tenant role sees only its own tenant, and sees a nonzero number of rows.
SELECT 'duff role' AS check_name, tenant_id, COUNT(*) AS sales
FROM serving.sales GROUP BY 1, 2;

USE ROLE tenant_krusty;
SELECT 'krusty role' AS check_name, tenant_id, COUNT(*) AS sales
FROM serving.sales GROUP BY 1, 2;

-- 2. Naming the other tenant explicitly returns nothing. This is the predicate
--    that has to hold when Cortex Analyst generates SQL from an adversarial
--    question.
USE ROLE tenant_duff;
SELECT 'duff asking for krusty' AS check_name, COUNT(*) AS rows_returned
FROM serving.sales WHERE tenant_id = 'krusty';

SELECT 'duff asking for all tenants' AS check_name, COUNT(DISTINCT tenant_id) AS tenants_visible
FROM serving.sales;

-- 3. An aggregate that would span tenants stays scoped.
SELECT 'duff cross-tenant aggregate' AS check_name, tenant_id, ROUND(SUM(amount), 2) AS revenue
FROM serving.sales GROUP BY 1, 2;

-- 4. The base schema is unreachable, so the entitlements join cannot be bypassed.
--    Expected: a privilege error naming BASE.
USE ROLE tenant_duff;
SELECT 'duff reaching base' AS check_name, COUNT(*) FROM springfield_db.base.sales;
