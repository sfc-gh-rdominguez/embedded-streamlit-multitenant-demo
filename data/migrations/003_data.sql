-- Sales model shared by all tenants (ported from the multitenant-table reference).
--
-- Every tenant's rows live in one physical table, clustered by (tenant_id,
-- sale_ts) so a tenant-scoped query prunes the other tenants' micro-partitions.
-- Isolation is enforced by the secure view in `serving`, which joins an
-- entitlements table on CURRENT_ROLE(); the `base` schema is never granted to a
-- tenant.
USE ROLE springfield_admin;
USE WAREHOUSE springfield_wh;
USE SCHEMA springfield_db.base;

CREATE OR REPLACE TABLE base.sales (
  tenant_id STRING,
  sale_id   NUMBER,
  sale_ts   TIMESTAMP_NTZ,
  region    STRING,
  product   STRING,
  quantity  NUMBER,
  amount    NUMBER(12, 2)
) CLUSTER BY (tenant_id, sale_ts);

INSERT INTO base.sales
SELECT
  GET(ARRAY_CONSTRUCT('duff','krusty'), UNIFORM(0,1,RANDOM()))::STRING           AS tenant_id,
  seq8()                                                                          AS sale_id,
  DATEADD('second', UNIFORM(0, 60*60*24*365, RANDOM()), '2024-01-01'::TIMESTAMP_NTZ) AS sale_ts,
  GET(ARRAY_CONSTRUCT('NA','EMEA','APAC','LATAM'), UNIFORM(0,3,RANDOM()))::STRING AS region,
  GET(ARRAY_CONSTRUCT('Widget','Gadget','Gizmo','Doohickey','Sprocket'),
      UNIFORM(0,4,RANDOM()))::STRING                                             AS product,
  UNIFORM(1,100,RANDOM())                                                        AS quantity,
  ROUND(UNIFORM(500,50000,RANDOM())/100.0, 2)                                    AS amount
FROM TABLE(GENERATOR(ROWCOUNT => 200000));

-- Entitlements map a ROLE to its tenant. One role per tenant for the pilot; add
-- rows here to introduce access levels within a tenant later.
CREATE OR REPLACE TABLE base.entitlements (role_name STRING, tenant_id STRING);
INSERT INTO base.entitlements VALUES
  ('TENANT_DUFF',   'duff'),
  ('TENANT_KRUSTY', 'krusty');

-- Secure view: the only path tenant roles have to the data. The entitlements
-- join keys on CURRENT_ROLE(), so a query only ever sees its own tenant's rows,
-- no matter what the application or Cortex Analyst asks for.
CREATE OR REPLACE SECURE VIEW serving.sales AS
  SELECT s.tenant_id, s.sale_id, s.sale_ts, s.region, s.product, s.quantity, s.amount
  FROM base.sales s
  JOIN base.entitlements e ON s.tenant_id = e.tenant_id
  WHERE e.role_name = CURRENT_ROLE();
