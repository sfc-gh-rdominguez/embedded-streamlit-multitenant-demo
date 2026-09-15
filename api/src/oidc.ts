const KEYCLOAK = process.env.KEYCLOAK_URL!;
const REALM = process.env.REALM ?? "tenants";
const CLIENT_ID = process.env.WEB_CLIENT_ID!;
const CLIENT_SECRET = process.env.WEB_CLIENT_SECRET!;
const BASE = process.env.APP_BASE_URL!;
const REDIRECT_URI = `${BASE}/auth/callback`;
const OIDC = `${KEYCLOAK}/realms/${REALM}/protocol/openid-connect`;

export type TokenSet = { access_token: string; refresh_token: string; id_token: string; expires_in: number };
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export const pkceVerifier = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const challenge = async (v: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));

export const authorizeUrl = (state: string, codeChallenge: string) =>
  `${OIDC}/auth?` + new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", scope: "openid",
    redirect_uri: REDIRECT_URI, state, code_challenge: codeChallenge, code_challenge_method: "S256",
  });

const tokenCall = async (body: Record<string, string>): Promise<TokenSet> => {
  const res = await fetch(`${OIDC}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenSet;
};

export const exchangeCode = (code: string, verifier: string) =>
  tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
export const refresh = (refreshToken: string) =>
  tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
export const logoutUrl = (idToken: string) =>
  `${OIDC}/logout?` + new URLSearchParams({ id_token_hint: idToken, post_logout_redirect_uri: BASE });
