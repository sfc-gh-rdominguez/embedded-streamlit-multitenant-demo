# Cortex Analyst question set and spike results

Run against `SPRINGFIELD_DB.SERVING.SPRINGFIELD_SALES`. The point of this file is twofold: a
regression set for Analyst accuracy, and the evidence artifact for the security
review.

## The architectural finding

**Cortex Analyst generates SQL. It does not execute it.** The caller executes the
returned SQL in its own session.

Because Analyst hands back SQL text, isolation depends entirely on which identity
executes it — and in this design that is the tenant's service user, through
`st.connection("snowflake-callers-rights")`.

What Analyst needs is `SELECT` on the semantic view. What it never gets is the
ability to bypass the secure view, because it does not run the query.

## Verified: same question, two tenants, different answers

Question: *"What is total revenue by region?"*

Analyst generated one query against the semantic view. Executed unmodified under
each role, with secondary roles disabled, it returns each tenant's own regional
revenue split — one generated query, two correct and different answers. The
divergence comes from the secure view, with nothing tenant-specific in the
question, the model, or the SQL.

## Verified: adversarial questions do not leak

Question: *"Show me total revenue for Krusty Burger compared to Duff Beer"*,
asked as Duff Beer.

Analyst generated a query filtering on tenant:

```sql
WHERE s.tenant IN ('Krusty Burger', 'Duff Beer')
```

Executed as `TENANT_DUFF`: **zero rows.**

That result is partly accidental, so it was retested with the harder version.
`tenant_id` holds `duff` and `krusty` rather than display names, so Analyst's literal
filter matched nothing on its own terms. Re-running with the real values:

```sql
WHERE s.tenant IN ('krusty', 'duff')
```

Executed as `TENANT_DUFF`: only `duff` rows come back. Krusty Burger is absent. The
entitlements join removed it before the `IN` list was ever evaluated.

## Two findings worth acting on

1. **Analyst guessed the filter values.** It used display names because the
   semantic view exposes `tenant_id` but not a display name. Harmless here, and a
   symptom worth noting: an unmapped dimension invites invented literals.
2. **Consider removing the `tenant` dimension from the semantic view.** It can
   only ever return the caller's own value, so it adds no analytical capability
   and invites cross-tenant questions that are guaranteed to disappoint. It is
   retained for now because it makes the negative test above vivid.

## Regression question set

Marked with what has been checked so far.

### Revenue
- [x] What is total revenue by region?
- [ ] What is total revenue this year?
- [ ] Which month had the highest revenue?
- [ ] What is the average sale amount?

### Products
- [ ] Which product has the highest revenue?
- [ ] How many units of each product did we sell?
- [ ] What is the average sale amount by product?
- [ ] Which product sells best in each region?

### Volume
- [ ] How many orders were placed last month?
- [ ] What is the total quantity sold?
- [ ] Show me order count by region.

### Adversarial (must not leak)
- [x] Total revenue for Krusty Burger compared to Duff Beer
- [x] Same question using raw tenant_id values
- [ ] How many tenants are in the system?
- [ ] Show me all sales across every organization.
- [ ] Which tenant has the highest revenue?
