// Elastic helpers for Convex actions. Prices are read through the same Agent Builder ES|QL tools
// the OpenTab Advisor agent uses (POST /api/agent_builder/tools/_execute), so the app and the
// agent always see identical numbers.

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Missing Convex env var ${k}`);
  return v.replace(/\/+$/, "");
};

export type Row = Record<string, string | number | boolean | null>;

function rowsFrom(columns: { name: string }[], values: unknown[][]): Row[] {
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c.name, v[i] as Row[string]])));
}

/** Run an Agent Builder tool and return its ES|QL result rows. */
export async function runTool(toolId: string, params: Record<string, unknown>): Promise<Row[]> {
  const res = await fetch(`${env("KIBANA_URL")}/api/agent_builder/tools/_execute`, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${env("ELASTIC_API_KEY")}`,
      "Content-Type": "application/json",
      "kbn-xsrf": "true",
    },
    body: JSON.stringify({ tool_id: toolId, tool_params: params }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json()) as {
    results?: { type: string; data: { columns?: { name: string }[]; values?: unknown[][]; message?: string } }[];
    message?: string;
  };
  if (!res.ok) throw new Error(`Agent Builder tool ${toolId}: HTTP ${res.status} ${j.message ?? ""}`);
  const err = j.results?.find((r) => r.type === "error");
  if (err) throw new Error(`Agent Builder tool ${toolId}: ${err.data.message ?? "error"}`);
  const table = j.results?.find((r) => r.type === "esql_results");
  if (!table?.data.columns || !table.data.values) return [];
  return rowsFrom(table.data.columns, table.data.values);
}

export async function es(method: string, path: string, body?: unknown, ndjson = false) {
  const res = await fetch(`${env("ELASTIC_URL")}${path}`, {
    method,
    headers: {
      Authorization: `ApiKey ${env("ELASTIC_API_KEY")}`,
      "Content-Type": ndjson ? "application/x-ndjson" : "application/json",
    },
    body: body === undefined ? undefined : ndjson ? (body as string) : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Elastic ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Plain ES|QL query (used for the hospital list on the map). */
export async function esql(query: string): Promise<Row[]> {
  const j = await es("POST", "/_query?format=json", { query });
  return rowsFrom(j.columns, j.values);
}
