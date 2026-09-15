-- Semantic view for Cortex Analyst.
--
-- Built entirely on the secure view in `serving`, which is the point: Analyst
-- generates SQL against this, the secure view applies the entitlements join on
-- CURRENT_ROLE(), and a generated query therefore cannot reach another tenant's
-- rows no matter what the question asks for.
--
-- Grain: SALES is one row per sale, so every metric aggregates at sale grain and
-- nothing fans out.
USE ROLE springfield_admin;
USE WAREHOUSE springfield_wh;
USE SCHEMA springfield_db.serving;

CREATE OR REPLACE SEMANTIC VIEW springfield_db.serving.springfield_sales
  TABLES (
    sales AS springfield_db.serving.sales
      PRIMARY KEY (sale_id)
      WITH SYNONYMS ('orders', 'transactions', 'sales')
      COMMENT = 'One row per sale.'
  )
  FACTS (
    sales.amount AS amount
      COMMENT = 'Revenue for this sale, in dollars.',
    sales.quantity AS quantity
      COMMENT = 'Units sold in this sale.'
  )
  DIMENSIONS (
    sales.tenant AS tenant_id
      COMMENT = 'Tenant that owns this row. Always the querying tenant; rows for other tenants are not visible.',
    sales.region AS region
      WITH SYNONYMS ('territory', 'geo', 'area')
      COMMENT = 'Sales region: NA, EMEA, APAC, or LATAM.',
    sales.product AS product
      WITH SYNONYMS ('item', 'sku')
      COMMENT = 'Product sold: Widget, Gadget, Gizmo, Doohickey, or Sprocket.',
    sales.sale_date AS DATE(sale_ts)
      WITH SYNONYMS ('date', 'day')
      COMMENT = 'Calendar date of the sale.',
    sales.sale_month AS DATE_TRUNC('month', sale_ts)
      WITH SYNONYMS ('month')
      COMMENT = 'Month of the sale.'
  )
  METRICS (
    sales.total_revenue AS SUM(sales.amount)
      WITH SYNONYMS ('revenue', 'sales', 'total sales', 'gross revenue')
      COMMENT = 'Total revenue in dollars.',
    sales.total_quantity AS SUM(sales.quantity)
      WITH SYNONYMS ('units sold', 'total units')
      COMMENT = 'Total units sold.',
    sales.order_count AS COUNT(sales.sale_id)
      WITH SYNONYMS ('number of sales', 'orders', 'transactions')
      COMMENT = 'Number of sales.',
    sales.avg_sale AS AVG(sales.amount)
      WITH SYNONYMS ('average order value', 'average sale', 'avg revenue')
      COMMENT = 'Average revenue per sale, in dollars.'
  )
  COMMENT = 'Sales analytics: revenue, units, and order counts by region, product, and time. Every underlying view is a secure view that returns only the querying tenant rows.';

-- Tenant roles need SELECT to ask questions through Cortex Analyst.
GRANT SELECT ON SEMANTIC VIEW springfield_db.serving.springfield_sales TO ROLE tenant_duff;
GRANT SELECT ON SEMANTIC VIEW springfield_db.serving.springfield_sales TO ROLE tenant_krusty;
