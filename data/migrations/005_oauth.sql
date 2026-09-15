-- Snowflake fetches the signing keys from the tunnel URL and auto-refreshes
-- them, so Keycloak key rotation never breaks things.
USE ROLE ACCOUNTADMIN;

CREATE OR REPLACE SECURITY INTEGRATION springfield_keycloak
  TYPE = EXTERNAL_OAUTH
  ENABLED = TRUE
  EXTERNAL_OAUTH_TYPE = CUSTOM
  EXTERNAL_OAUTH_ISSUER = '__KEYCLOAK_PUBLIC_URL__/realms/tenants'
  EXTERNAL_OAUTH_JWS_KEYS_URL = '__KEYCLOAK_PUBLIC_URL__/realms/tenants/protocol/openid-connect/certs'
  EXTERNAL_OAUTH_AUDIENCE_LIST = ('snowflake')
  EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM = 'snowflake_user'
  EXTERNAL_OAUTH_SNOWFLAKE_USER_MAPPING_ATTRIBUTE = 'LOGIN_NAME'
  EXTERNAL_OAUTH_SCOPE_MAPPING_ATTRIBUTE = 'scp';
