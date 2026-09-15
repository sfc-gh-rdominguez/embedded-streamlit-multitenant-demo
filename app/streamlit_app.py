"""Embedded sales analytics for the multitenant demo.

Runs as a Streamlit in Snowflake container-runtime app, embedded in the Springfield
sales app via an iframe. Queries go through the caller-rights connection, so the
session runs as the tenant's service identity and the secure views in
SPRINGFIELD_DB.SERVING return only that tenant's rows.

Cortex Analyst generates SQL; this app executes it on that same connection. That
is what keeps generated SQL tenant-scoped, since Analyst never runs the query.

Two container-runtime constraints shape this file, and both are load-bearing for
a multi-tenant app:

1. NO CACHING OF ANYTHING TENANT-SCOPED. A container runtime serves every viewer
   from one shared process, so `st.cache_data` and `st.cache_resource` are global
   across viewers. Caching a caller-rights session or a query result would let one
   tenant's data reach another tenant. Every query below runs with `ttl=0`, and no
   session object is held between reruns. Caching a session also produces
   "(1404): Cannot perform this operation because the session has been closed"
   once the underlying connection is recycled.

2. `_snowflake` DOES NOT EXIST HERE. It is available only in UDFs, stored
   procedures, and warehouse runtimes. Cortex Analyst is therefore called over
   plain HTTPS using the session's own REST token.
"""

import os
import sys

import pandas as pd
import streamlit as st

CALLER_CONNECTION = "snowflake-callers-rights"
WAREHOUSE = "SPRINGFIELD_WH"

st.set_page_config(page_title="Sales Analytics", layout="wide")


def resolve_connection():
    """Return (connection, name, errors) without caching the session.

    Prefers caller rights, since that is what the secure views key on. Falls back
    to the owner's-rights connection only so the page can render and say that
    tenant scoping is not in effect.
    """
    errors = {}
    for name in (CALLER_CONNECTION, "snowflake"):
        try:
            conn = st.connection(name)
            conn.query("SELECT 1", ttl=0)
            return conn, name, errors
        except Exception as exc:
            errors[name] = f"{type(exc).__name__}: {exc}"
    return None, None, errors


conn, conn_name, conn_errors = resolve_connection()

if conn is None:
    st.error("Could not open a Snowflake connection.")
    st.json(conn_errors)
    st.stop()


def _coerce_numeric(df):
    """Turn genuinely-numeric columns into real numbers.

    Snowflake NUMBER columns arrive over this connection as Decimal/object. That
    formats fine in st.metric and st.dataframe, but st.bar_chart serializes an
    object column as strings and renders a nominal axis instead of bar heights
    (you get quoted values like "623594452" and floating bars). Coerce any column
    whose non-null values all parse as numbers; leave text columns (region,
    product) untouched.
    """
    for c in df.columns:
        converted = pd.to_numeric(df[c], errors="coerce")
        if converted.notna().equals(df[c].notna()):
            df[c] = converted
    return df


def q(sql: str):
    """Every read goes through here: caller-rights connection, never cached."""
    return _coerce_numeric(conn.query(sql, ttl=0))


def current_session_context():
    return q(
        "SELECT CURRENT_USER() AS u, CURRENT_ROLE() AS r, "
        "COALESCE(CURRENT_WAREHOUSE(), 'none') AS w"
    ).iloc[0]


session_context = None
session_context_error = None
try:
    session_context = current_session_context()
except Exception as exc:
    session_context_error = f"{type(exc).__name__}: {exc}"


bootstrap_checks = {
    "connection_name": conn_name,
    "connection_errors": conn_errors,
    "session_context_error": session_context_error,
    "session_context": None if session_context is None else session_context.to_dict(),
}

bootstrap_failures = []
if conn_name != CALLER_CONNECTION:
    bootstrap_failures.append(
        f"Connected with `{conn_name}` instead of `{CALLER_CONNECTION}`; tenant-scoped caller rights are not active."
    )
if session_context is None:
    bootstrap_failures.append("Could not resolve CURRENT_USER/CURRENT_ROLE/CURRENT_WAREHOUSE.")
elif session_context["W"] == "none":
    bootstrap_failures.append(
        f"Caller-rights session has no active warehouse. Expected `{WAREHOUSE}` or another usable warehouse."
    )


# --- Header ---------------------------------------------------------------
if session_context is not None:
    st.caption(
        f"Snowflake user **{session_context['U']}** · role **{session_context['R']}** · "
        f"warehouse **{session_context['W']}** · connection `{conn_name}`"
    )
else:
    st.caption(f"Could not resolve session identity: {session_context_error}")

if conn_name != CALLER_CONNECTION:
    st.warning(
        f"Running on the **{conn_name}** connection, not `{CALLER_CONNECTION}`. "
        "Queries execute as the app owner, so tenant scoping is NOT applied."
    )
    with st.expander("Connection errors"):
        st.json(conn_errors)

if session_context is not None and session_context["W"] == "none":
    st.warning(
        f"No active warehouse is set for this caller-rights session. Queries below "
        f"may fail until the signed-in identity resolves to **{WAREHOUSE}** or another usable warehouse."
    )

if bootstrap_failures:
    st.error("Bootstrap checks failed. Fix the session state below before expecting dashboard queries to work.")
    for failure in bootstrap_failures:
        st.write(f"- {failure}")
    with st.expander("Bootstrap diagnostics", expanded=True):
        st.json(bootstrap_checks)
    st.stop()

try:
    k = q(
        """
        SELECT COUNT(*) AS orders,
               ROUND(SUM(amount), 2) AS revenue,
               SUM(quantity) AS units,
               ROUND(AVG(amount), 2) AS avg_sale
        FROM SPRINGFIELD_DB.SERVING.SALES
        """
    ).iloc[0]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Orders", f"{int(k['ORDERS']):,}")
    c2.metric("Revenue", "n/a" if k["REVENUE"] is None else f"${k['REVENUE']:,.2f}")
    c3.metric("Units sold", "n/a" if k["UNITS"] is None else f"{int(k['UNITS']):,}")
    c4.metric("Avg sale", "n/a" if k["AVG_SALE"] is None else f"${k['AVG_SALE']:,.2f}")
except Exception as exc:
    st.error(f"Could not load headline metrics: {exc}")

st.divider()

# --- Always-on visuals ----------------------------------------------------
with st.container():
    st.subheader("Revenue by region")
    st.caption("Total revenue per sales region for your organization.")
    try:
        by_region = q(
            "SELECT region, ROUND(SUM(amount), 2) AS revenue "
            "FROM SPRINGFIELD_DB.SERVING.SALES GROUP BY 1 ORDER BY revenue DESC"
        )
        if by_region.empty:
            st.info("No sales visible for your organization.")
        else:
            st.bar_chart(by_region.set_index("REGION")["REVENUE"], height=240)
    except Exception as exc:
        st.error(f"Could not load the revenue-by-region chart: {exc}")

    st.subheader("Top products")
    try:
        products = q(
            "SELECT product, COUNT(*) AS orders, ROUND(SUM(amount), 2) AS revenue, "
            "ROUND(AVG(amount), 2) AS avg_sale "
            "FROM SPRINGFIELD_DB.SERVING.SALES GROUP BY 1 ORDER BY revenue DESC"
        )
        if products.empty:
            st.info("No sales recorded.")
        else:
            st.dataframe(products, use_container_width=True, hide_index=True)
    except Exception as exc:
        st.error(f"Could not load top products: {exc}")

with st.expander("Runtime diagnostics"):
    st.write(
        {
            "python": sys.version.split()[0],
            "streamlit": st.__version__,
            "connection": conn_name,
            "connection_errors": conn_errors,
            "session_context": None if session_context is None else session_context.to_dict(),
            "session_context_error": session_context_error,
            "snowflake_host_env": os.getenv("SNOWFLAKE_HOST"),
        }
    )
