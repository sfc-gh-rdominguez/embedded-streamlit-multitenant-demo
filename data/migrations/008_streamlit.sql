-- The Streamlit app is deployed by `snow streamlit deploy` in the `just setup`
-- recipe, immediately before this migration runs. It is a container-runtime app,
-- so it cannot be created from pure SQL (its streamlit_app.py and pyproject.toml
-- must be uploaded as stage artifacts, which the deploy command handles).
--
-- Because the app ships a pyproject.toml, the container runtime's `uv` resolves
-- packages at startup. By default it has no package index, so it tries public
-- PyPI and fails with "Failed to retrieve packages ... Name does not resolve".
-- The fix is to attach Snowflake's built-in PyPI mirror artifact repository,
-- which serves packages from inside the account with no external egress. The app
-- owner (springfield_admin) needs the PYPI_REPOSITORY_USER database role to use it.
USE ROLE ACCOUNTADMIN;
GRANT DATABASE ROLE SNOWFLAKE.PYPI_REPOSITORY_USER TO ROLE springfield_admin;

USE ROLE springfield_admin;
ALTER STREAMLIT springfield_db.serving.springfield_sales_app
  SET ARTIFACT_REPOSITORIES = (snowflake.snowpark.pypi_shared_repository);

-- Grant each tenant role USAGE on the deployed app so
-- SYSTEM$STREAMLIT_GENERATE_EMBED_URL resolves and the iframe session — running
-- as the tenant service user — can open it.
GRANT USAGE ON STREAMLIT springfield_db.serving.springfield_sales_app TO ROLE tenant_duff;
GRANT USAGE ON STREAMLIT springfield_db.serving.springfield_sales_app TO ROLE tenant_krusty;

-- Caller grants. The app reads its data through st.connection("snowflake-callers-rights"),
-- which runs on restricted caller's rights: queries execute as the viewer (the
-- tenant), which is what makes the CURRENT_ROLE() filter in serving.sales scope
-- to that tenant. RCR requires the app owner to hold caller grants on every
-- object the app touches on the viewer's behalf, or the query fails with
-- "the owner role ... must have at least one CALLER privilege granted on ...".
-- A caller grant confers no privilege itself; it only authorizes the app to use
-- a privilege the caller already holds, so tenant isolation is unchanged. These
-- were previously applied by hand and never captured here, so a teardown wiped
-- them and the app broke; codifying them keeps the demo reproducible bottoms-up.
USE ROLE ACCOUNTADMIN;
GRANT MANAGE CALLER GRANTS ON ACCOUNT TO ROLE ACCOUNTADMIN;
GRANT CALLER USAGE ON DATABASE springfield_db TO ROLE springfield_admin;
GRANT CALLER USAGE ON SCHEMA springfield_db.serving TO ROLE springfield_admin;
GRANT CALLER SELECT ON VIEW springfield_db.serving.sales TO ROLE springfield_admin;
