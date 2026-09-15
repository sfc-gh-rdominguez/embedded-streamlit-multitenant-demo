import { useEffect, useState } from "react";

type Me = { user: string; scp: string; snowflake_user: string };
type View = {
  user: string;
  error?: string;
  claims: { snowflake_user: string; scp: string; aud: string };
  identity: { USER: string; ROLE: string; WAREHOUSE: string };
};
type ChatResult = {
  answer: string;
  texts?: string[];
  sql?: string[];
  suggestions?: string[];
  result?: unknown;
  executed_sql?: string | null;
  executed_rows?: Array<Record<string, unknown>>;
  executed_row_count?: number;
  execution_error?: string | null;
  analyst?: unknown;
  request_id?: string | null;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  details?: ChatResult;
};

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [ready, setReady] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [embedState, setEmbedState] = useState<string>("loading");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);

  const renderValue = (value: unknown) => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number") return value.toLocaleString();
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  useEffect(() => {
    fetch("/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!me) return;
    fetch("/api/view").then((r) => r.json()).then(setView);
  }, [me]);

  // Embed URLs are single-use, so one is minted per render of the signed-in view.
  useEffect(() => {
    if (!me) return;
    fetch("/api/embed-url")
      .then((r) => r.json())
      .then((d) => (d.embedUrl ? setEmbedUrl(d.embedUrl) : setEmbedError(d.error ?? "no url")))
      .catch((e) => setEmbedError(String(e)));
  }, [me]);

  // Lifecycle events from the embedded app.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith(".snowflake.app")) return;
      const type = (event.data as { type?: string } | undefined)?.type;
      switch (type) {
        case "SNOWFLAKE_EMBED_LOADED":
          setEmbedState("ready");
          break;
        case "SNOWFLAKE_EMBED_ERROR":
          setEmbedState("error");
          break;
        case "SNOWFLAKE_EMBED_SUSPENDED":
          setEmbedState("suspended");
          break;
        case "SNOWFLAKE_EMBED_SESSION_EXPIRED":
          // The old URL cannot be refreshed, so mint a new one.
          setEmbedState("expired");
          fetch("/api/embed-url")
            .then((r) => r.json())
            .then((d) => d.embedUrl && (setEmbedUrl(d.embedUrl), setEmbedState("loading")));
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const signOut = async () => {
    const { logoutUrl } = await fetch("/auth/logout", { method: "POST" }).then((r) => r.json());
    window.location.href = logoutUrl; // end the Keycloak SSO session too
  };

  const sendQuestion = async () => {
    const trimmed = question.trim();
    if (!trimmed || chatBusy) return;

    const nextHistory = [...chat, { role: "user" as const, content: trimmed }];
    setChat(nextHistory);
    setQuestion("");
    setChatBusy(true);
    setChatError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          question: trimmed,
          history: chat,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? payload.analyst?.message ?? "Chat request failed");
      }
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.answer ?? "No response returned.",
          details: payload,
        },
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
      setChat((current) => current.slice(0, -1));
      setQuestion(trimmed);
    } finally {
      setChatBusy(false);
    }
  };

  if (!ready) return null;

  return (
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem 2rem", maxWidth: 1200, margin: "0 auto" }}>
      {!me ? (
        <a href="/auth/login">Sign in</a>
      ) : (
        <>
          <header style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Sales analytics</h2>
            <span style={{ color: "#666" }}>
              Signed in as <strong>{me.user}</strong>
              {view?.identity && (
                <>
                  {" "}· Snowflake <strong>{view.identity.USER}</strong> as{" "}
                  <strong>{view.identity.ROLE}</strong>
                </>
              )}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#888" }}>embed: {embedState}</span>
              <button onClick={signOut}>Sign out</button>
            </span>
          </header>

          {view?.error && (
            <pre style={{ background: "#fdeaea", padding: "1rem", whiteSpace: "pre-wrap" }}>{view.error}</pre>
          )}
          {embedError && (
            <pre style={{ background: "#fdeaea", padding: "1rem", whiteSpace: "pre-wrap" }}>
              Could not mint an embed URL: {embedError}
            </pre>
          )}

          <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(320px, 1fr)", gap: "1rem", alignItems: "start", marginTop: "1rem" }}>
            <div>
              {embedUrl && (
                <iframe
                  title="Sales analytics"
                  src={embedUrl}
                  sandbox="allow-scripts allow-same-origin allow-downloads"
                  style={{ width: "100%", height: 820, border: "1px solid #ddd", borderRadius: 6 }}
                />
              )}
              {!embedUrl && !embedError && <p style={{ color: "#666" }}>Loading the embedded app…</p>}
            </div>

            <aside style={{ border: "1px solid #ddd", borderRadius: 6, minHeight: 820, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "1rem", borderBottom: "1px solid #eee" }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>Ask about your tenant data</h3>
                <p style={{ margin: "0.5rem 0 0", color: "#666", fontSize: 14 }}>
                  Questions are sent through the BFF with your tenant-scoped Snowflake OAuth session.
                </p>
              </div>

              <div style={{ flex: 1, padding: "1rem", overflowY: "auto", background: "#fafafa" }}>
                {chat.length === 0 ? (
                  <p style={{ color: "#666", marginTop: 0 }}>Try: Which product has the highest revenue?</p>
                ) : (
                  chat.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      style={{
                        marginBottom: "0.75rem",
                        padding: "0.75rem",
                        borderRadius: 6,
                        background: message.role === "user" ? "#eef4ff" : "#fff",
                        border: "1px solid #e5e5e5",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem", textTransform: "capitalize" }}>
                        {message.role}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{message.content}</div>
                      {message.role === "assistant" && message.details && (
                        <details style={{ marginTop: "0.75rem" }}>
                          <summary style={{ cursor: "pointer", color: "#666" }}>Analysis details</summary>
                          <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
                            {Array.isArray(message.details.sql) && message.details.sql.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem" }}>Generated SQL</div>
                                {message.details.sql.map((statement, statementIndex) => (
                                  <pre
                                    key={statementIndex}
                                    style={{ background: "#f4f4f4", padding: "0.75rem", borderRadius: 6, overflowX: "auto", margin: 0 }}
                                  >
                                    {statement}
                                  </pre>
                                ))}
                              </div>
                            )}
                            {message.details.execution_error && (
                              <div style={{ background: "#fdeaea", color: "#8a1f11", padding: "0.75rem", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                                SQL execution failed: {message.details.execution_error}
                              </div>
                            )}
                            {Array.isArray(message.details.executed_rows) && message.details.executed_rows.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem" }}>
                                  Query results{typeof message.details.executed_row_count === "number" ? ` (${message.details.executed_row_count} rows)` : ""}
                                </div>
                                <div style={{ overflowX: "auto", border: "1px solid #e5e5e5", borderRadius: 6, background: "#fff" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                                    <thead>
                                      <tr>
                                        {Object.keys(message.details.executed_rows[0]).map((column) => (
                                          <th
                                            key={column}
                                            style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #e5e5e5", background: "#f8f8f8" }}
                                          >
                                            {column}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {message.details.executed_rows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                          {Object.keys(message.details.executed_rows![0]).map((column) => (
                                            <td key={column} style={{ padding: "0.5rem", borderBottom: "1px solid #f0f0f0", verticalAlign: "top" }}>
                                              {renderValue(row[column])}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                            {Array.isArray(message.details.suggestions) && message.details.suggestions.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem" }}>Suggestions</div>
                                <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                                  {message.details.suggestions.map((suggestion, suggestionIndex) => (
                                    <li key={suggestionIndex}>{suggestion}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {message.details.result !== undefined && (
                              <div>
                                <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem" }}>Result payload</div>
                                <pre
                                  style={{ background: "#f4f4f4", padding: "0.75rem", borderRadius: 6, overflowX: "auto", margin: 0 }}
                                >
                                  {JSON.stringify(message.details.result, null, 2)}
                                </pre>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: 12, color: "#666", marginBottom: "0.35rem" }}>Raw Analyst payload</div>
                              <pre
                                style={{ background: "#f4f4f4", padding: "0.75rem", borderRadius: 6, overflowX: "auto", margin: 0 }}
                              >
                                {JSON.stringify(message.details.analyst ?? message.details, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </details>
                      )}
                    </div>
                  ))
                )}
                {chatBusy && <p style={{ color: "#666", margin: 0 }}>Waiting for Cortex Analyst…</p>}
              </div>

              <div style={{ padding: "1rem", borderTop: "1px solid #eee", display: "grid", gap: "0.75rem" }}>
                {chatError && (
                  <div style={{ background: "#fdeaea", color: "#8a1f11", padding: "0.75rem", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                    {chatError}
                  </div>
                )}
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about revenue, products, regions, or order volume"
                  rows={5}
                  style={{ width: "100%", resize: "vertical", padding: "0.75rem", font: "inherit", borderRadius: 6, border: "1px solid #ccc", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={sendQuestion} disabled={chatBusy || !question.trim()}>
                    Ask
                  </button>
                </div>
              </div>
            </aside>
          </section>

          {view?.claims && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", color: "#666" }}>Token asserts</summary>
              <pre style={{ background: "#f4f4f4", padding: "1rem" }}>{JSON.stringify(view.claims, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </main>
  );
}
