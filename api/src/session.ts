import { refresh, TokenSet } from "./oidc";

type Session = { tokens: TokenSet; expiresAt: number };
const sessions = new Map<string, Session>();
const pending = new Map<string, string>(); // state -> PKCE verifier

export const putPending = (state: string, verifier: string) => pending.set(state, verifier);
export const takePending = (state: string) => { const v = pending.get(state); pending.delete(state); return v; };

export const putSession = (sid: string, tokens: TokenSet) =>
  sessions.set(sid, { tokens, expiresAt: Date.now() + tokens.expires_in * 1000 });
export const getSession = (sid?: string) => (sid ? sessions.get(sid) : undefined);
export const dropSession = (sid: string) => sessions.delete(sid);

export const freshToken = async (s: Session): Promise<string> => {
  if (Date.now() < s.expiresAt - 30_000) return s.tokens.access_token;
  const t = await refresh(s.tokens.refresh_token);
  s.tokens = t; s.expiresAt = Date.now() + t.expires_in * 1000;
  return t.access_token;
};

export const cookie = (name: string, val: string, maxAge = 28800) =>
  `${name}=${val}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;   // add Secure behind TLS
export const readCookie = (header: string | null, name: string) =>
  header?.split(/; */).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
