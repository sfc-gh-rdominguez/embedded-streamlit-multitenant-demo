import { Elysia } from "elysia";
import { authorizeUrl, challenge, exchangeCode, logoutUrl, pkceVerifier } from "./oidc";
import * as store from "./session";
import { query, decodeClaims } from "./db";

const SID = "springfield_sid";
const BASE = process.env.APP_BASE_URL!;
const port = Number(process.env.SERVER_PORT) || 8001;
const ANALYST_PATH = "/api/v2/cortex/analyst/message";
const ANALYST_SEMANTIC_VIEW = process.env.ANALYST_SEMANTIC_VIEW ?? "SPRINGFIELD_DB.SERVING.SPRINGFIELD_SALES";
const to = (set: any, url: string) => { set.status = 302; set.headers["Location"] = url; return ""; };
const sid = (req: Request) => store.readCookie(req.headers.get("cookie"), SID);

const normalizeStatement = (statement: string) => statement.trim().replace(/;\s*$/, "");

const isSafeSelect = (statement: string) => {
  const normalized = normalizeStatement(statement);
  return /^(select|with)\b/i.test(normalized) && !/;\s*\S/.test(normalized);
};

const summarizeRows = (question: string, rows: Record<string, unknown>[]) => {
  if (rows.length === 0) return `No rows matched: ${question}`;

  const first = rows[0];
  const entries = Object.entries(first);
  const numericEntries = entries.filter(([, value]) => typeof value === "number");
  const labelEntries = entries.filter(([, value]) => typeof value === "string" && value !== "");

  const labelText = labelEntries
    .slice(0, 2)
    .map(([key, value]) => `${key.toLowerCase()} ${String(value)}`)
    .join(", ");
  const numericText = numericEntries
    .slice(0, 3)
    .map(([key, value]) => `${key.toLowerCase()} ${typeof value === "number" ? value.toLocaleString() : value}`)
    .join(", ");

  const lead = labelText || numericText
    ? `Top result: ${labelText}${labelText && numericText ? " with " : ""}${numericText}.`
    : "Top result returned.";

  return `${lead} Showing ${Math.min(rows.length, 10)} of ${rows.length} row${rows.length === 1 ? "" : "s"} for: ${question}`;
};

new Elysia()
  .get("/healthcheck", () => "ok")
  .get("/auth/login", async ({ set }) => {
    const state = crypto.randomUUID();
    const verifier = pkceVerifier();
    store.putPending(state, verifier);
    return to(set, String(authorizeUrl(state, await challenge(verifier))));
  })
  .get("/auth/callback", async ({ query: q, set }) => {
    const verifier = store.takePending(String(q.state ?? ""));
    if (!verifier || !q.code) return to(set, `${BASE}/?error=login`);
    const tokens = await exchangeCode(String(q.code), verifier);
    const id = crypto.randomUUID();
    store.putSession(id, tokens);
    set.headers["Set-Cookie"] = store.cookie(SID, id);
    return to(set, BASE);
  })
  .get("/auth/me", ({ request, set }) => {
    const s = store.getSession(sid(request));
    if (!s) { set.status = 401; return { error: "anonymous" }; }
    const c = decodeClaims(s.tokens.access_token);
    return { user: c.preferred_username ?? c.name, scp: c.scp, snowflake_user: c.snowflake_user };
  })
  .post("/auth/logout", ({ request, set }) => {
    const id = sid(request);
    const s = store.getSession(id);
    if (id) store.dropSession(id);
    set.headers["Set-Cookie"] = store.cookie(SID, "", 0);
    return { logoutUrl: s ? String(logoutUrl(s.tokens.id_token)) : BASE };
  })
  .get("/api/view", async ({ request, set }) => {
    const s = store.getSession(sid(request));
    if (!s) { set.status = 401; return { error: "anonymous" }; }
    try {
      const token = await store.freshToken(s);
      const claims = decodeClaims(token);
      const [identity] = await query(token,
        `SELECT CURRENT_USER() AS "USER", CURRENT_ROLE() AS "ROLE", CURRENT_WAREHOUSE() AS "WAREHOUSE"`);
      const byRegion = await query(token,
        `SELECT region AS "REGION", COUNT(*) AS "ORDERS",
                ROUND(SUM(amount), 2) AS "REVENUE", SUM(quantity) AS "UNITS"
           FROM serving.sales GROUP BY 1 ORDER BY "REVENUE" DESC`);
      const topProducts = await query(token,
        `SELECT product AS "PRODUCT", COUNT(*) AS "ORDERS",
                ROUND(SUM(amount), 2) AS "REVENUE", ROUND(AVG(amount), 2) AS "AVG_SALE"
           FROM serving.sales GROUP BY 1 ORDER BY "REVENUE" DESC`);
      return {
        user: claims.preferred_username ?? claims.name,
        claims: { snowflake_user: claims.snowflake_user, scp: claims.scp, aud: claims.aud },
        identity, byRegion, topProducts,
      };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  // Mints a short-lived, single-use embed URL for the Streamlit app, as the
  // caller. The app therefore runs as the tenant's service identity and its
  // queries are scoped by the secure views. Never cache the URL: it is valid for
  // one load, so the browser fetches a fresh one on every render.
  .get("/api/embed-url", async ({ request, set }) => {
    const s = store.getSession(sid(request));
    if (!s) { set.status = 401; return { error: "anonymous" }; }
    try {
      const token = await store.freshToken(s);
      const app = (process.env.STREAMLIT_APP ?? "").replace(/'/g, "''");
      const origin = (process.env.PARENT_ORIGIN ?? "").replace(/'/g, "''");
      if (!app || !origin) throw new Error("STREAMLIT_APP and PARENT_ORIGIN must be set");
      const [row] = await query(token,
        `SELECT SYSTEM$STREAMLIT_GENERATE_EMBED_URL('${app}', '${origin}') AS "PAYLOAD"`);
      const payload = (row as { PAYLOAD: string }).PAYLOAD;
      return { embedUrl: (JSON.parse(payload) as { embed_url: string }).embed_url };
    } catch (err) {
      set.status = 500;
      console.error("/api/embed-url failed", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .post("/api/chat", async ({ request, set }) => {
    const s = store.getSession(sid(request));
    if (!s) { set.status = 401; return { error: "anonymous" }; }
    try {
      const body = await request.json() as {
        question?: string;
        history?: Array<{ role: string; content: string }>;
      };
      const question = String(body.question ?? "").trim();
      if (!question) {
        set.status = 400;
        return { error: "question is required" };
      }

      const token = await store.freshToken(s);
      const claims = decodeClaims(token);
      const role = String(claims.scp ?? "").replace(/^session:role:/, "");
      const history = Array.isArray(body.history)
        ? body.history
            .filter((message) => message && typeof message.role === "string" && typeof message.content === "string")
            .slice(-8)
        : [];

      const messages = [
        ...history.map((message) => ({
          role: message.role,
          content: [{ type: "text", text: message.content }],
        })),
        { role: "user", content: [{ type: "text", text: question }] },
      ];

      const resp = await fetch(`https://${process.env.SNOWFLAKE_HOST}${ANALYST_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Snowflake-Authorization-Token-Type": "OAUTH",
          "X-Snowflake-Role": role,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          semantic_view: ANALYST_SEMANTIC_VIEW,
          messages,
        }),
      });

      const payload = await resp.json().catch(async () => ({ raw: await resp.text() }));
      if (!resp.ok) {
        set.status = resp.status;
        return {
          error: "Analyst request failed",
          analyst: payload,
          request_id: resp.headers.get("x-snowflake-request-id"),
        };
      }

      const content = Array.isArray(payload?.message?.content) ? payload.message.content : [];
      const textParts = content
        .filter((item: { type?: string; text?: string }) => item?.type === "text" && typeof item.text === "string")
        .map((item: { text: string }) => item.text.trim())
        .filter(Boolean);
      const sqlParts = content
        .filter((item: { type?: string; statement?: string; sql?: string }) => item?.type === "sql")
        .map((item: { statement?: string; sql?: string }) => (item.statement ?? item.sql ?? "").trim())
        .filter(Boolean);
      const suggestionParts = content
        .filter((item: { type?: string; suggestions?: string[]; suggestion?: string }) => item?.type === "suggestions")
        .flatMap((item: { suggestions?: string[]; suggestion?: string }) => {
          if (Array.isArray(item.suggestions)) return item.suggestions;
          return item.suggestion ? [item.suggestion] : [];
        })
        .map((suggestion: string) => suggestion.trim())
        .filter(Boolean);
      const safeSql = sqlParts.map(normalizeStatement).find(isSafeSelect);
      let executedRows: Record<string, unknown>[] = [];
      let executedSql: string | null = null;
      let executionError: string | null = null;

      if (safeSql) {
        executedSql = safeSql;
        try {
          executedRows = await query<Record<string, unknown>>(token, safeSql);
        } catch (err) {
          executionError = err instanceof Error ? err.message : String(err);
        }
      }

      const answer = executedRows.length > 0
        ? summarizeRows(question, executedRows)
        : textParts.join("\n\n") || "No text response returned.";

      return {
        answer,
        texts: textParts,
        sql: sqlParts,
        suggestions: suggestionParts,
        result: payload?.result,
        executed_sql: executedSql,
        executed_rows: executedRows.slice(0, 25),
        executed_row_count: executedRows.length,
        execution_error: executionError,
        request_id: resp.headers.get("x-snowflake-request-id"),
        analyst: payload,
      };
    } catch (err) {
      set.status = 500;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  })
  .listen({ port, hostname: "0.0.0.0" });
console.log(`bff on ${port}`);
