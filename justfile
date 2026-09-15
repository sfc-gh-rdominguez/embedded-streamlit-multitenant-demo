set dotenv-load := true

# Full bootstrap in the correct order. oauth-add MUST come after idp-seed so the
# OAuth integration fetches the realm's freshly-generated signing keys; otherwise
# logins fail with 390303 Invalid OAuth access token. After this, open the app
# once in Snowsight to warm it, then sign in at http://localhost:8000.
bootstrap connection:
  just setup {{connection}}
  just idp-up
  just idp-seed
  just idp-add-users
  just oauth-add {{connection}}
  just app-up

# Basic bootstrapping
setup connection:
  snow sql -c {{connection}} -f data/migrations/001_init.sql
  snow sql -c {{connection}} -f data/migrations/002_objects.sql
  snow sql -c {{connection}} -f data/migrations/003_data.sql
  snow sql -c {{connection}} -f data/migrations/004_tenants.sql
  snow sql -c {{connection}} -f data/migrations/007_semantic_view.sql
  cd app && snow streamlit deploy springfield_sales_app --connection {{connection}} --role SPRINGFIELD_ADMIN --replace
  snow sql -c {{connection}} -f data/migrations/008_streamlit.sql

# Prove tenant isolation from the data layer alone
verify connection:
  snow sql -c {{connection}} -f tests/isolation.sql

# Redeploy the Streamlit app (e.g. after app code changes) and reapply its
# post-deploy settings. `snow streamlit deploy --replace` REPLACES the app object,
# which drops its ARTIFACT_REPOSITORIES attach and app-level USAGE grants; 008
# puts them back. Never run a bare `snow streamlit deploy` on its own.
redeploy connection:
  cd app && snow streamlit deploy springfield_sales_app --connection {{connection}} --role SPRINGFIELD_ADMIN --replace
  snow sql -c {{connection}} -f data/migrations/008_streamlit.sql

# IdP-related bootstrapping
idp-up:
  docker compose up -d keycloak ngrok
  @echo "waiting for keycloak + tunnel..."; sleep 20

idp-seed:
  chmod +x auth/scripts/bootstrap.sh
  ./auth/scripts/bootstrap.sh

oauth-add connection:
  sed "s|__KEYCLOAK_PUBLIC_URL__|${KEYCLOAK_PUBLIC_URL}|g" data/migrations/005_oauth.sql > /tmp/springfield_005.sql
  snow sql -c {{connection}} -f /tmp/springfield_005.sql

idp-add-users:
  chmod +x auth/scripts/users.sh
  ./auth/scripts/users.sh

app-up:
  docker compose up -d --build api web

teardown connection:
  docker compose down -v
  snow sql -c {{connection}} -f data/teardown/teardown.sql
