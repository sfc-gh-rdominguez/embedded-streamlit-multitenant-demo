export const decodeClaims = (token: string): Record<string, unknown> => {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()); } catch { return {}; }
};

type RowType = { name: string; type: string };
const coerce = (raw: string | null, t: string) =>
  raw === null ? null : t === "fixed" || t === "real" ? Number(raw) : t === "boolean" ? raw === "true" : raw;

export const query = async <T = Record<string, unknown>>(token: string, statement: string): Promise<T[]> => {
  const role = String(decodeClaims(token).scp ?? "").replace(/^session:role:/, "");
  const warehouse = /^\s*select\s+system\$streamlit_generate_embed_url\s*\(/i.test(statement)
    ? undefined
    : process.env.SNOWFLAKE_WAREHOUSE;
  const res = await fetch(`https://${process.env.SNOWFLAKE_HOST}/api/v2/statements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Snowflake-Authorization-Token-Type": "OAUTH",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      statement, timeout: 60, role,
      warehouse,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
    }),
  });
  if (res.status !== 200) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  const p = (await res.json()) as { resultSetMetaData?: { rowType: RowType[] }; data?: (string | null)[][] };
  const rt = p.resultSetMetaData?.rowType ?? [];
  return (p.data ?? []).map((row) => {
    const o: Record<string, unknown> = {};
    rt.forEach((c, i) => (o[c.name] = coerce(row[i] ?? null, c.type)));
    return o as T;
  });
};
