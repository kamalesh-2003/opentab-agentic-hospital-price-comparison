// Tiny Elasticsearch REST helper (no client dependency). Reads ELASTIC_URL / ELASTIC_API_KEY from env.
export const INDEX = { prices: "opentab-prices", hospitals: "opentab-hospitals", procedures: "opentab-procedures" };

const base = () => {
  const u = process.env.ELASTIC_URL?.trim().replace(/\/+$/, "");
  if (!u || !process.env.ELASTIC_API_KEY) throw new Error("Set ELASTIC_URL and ELASTIC_API_KEY in .env.local");
  return u;
};

export async function es(method, path, body, { ndjson = false, ok404 = false } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}`,
      "Content-Type": ndjson ? "application/x-ndjson" : "application/json",
    },
    body: body === undefined ? undefined : ndjson ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok && !(ok404 && res.status === 404)) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

/** Bulk index docs: [{ _id, ...doc }]. Returns { indexed, errors }. */
export async function bulk(index, docs, chunk = 2000) {
  let indexed = 0;
  const errors = [];
  for (let i = 0; i < docs.length; i += chunk) {
    const lines = [];
    for (const { _id, ...doc } of docs.slice(i, i + chunk)) {
      lines.push(JSON.stringify({ index: { _index: index, _id } }), JSON.stringify(doc));
    }
    const r = await es("POST", "/_bulk", lines.join("\n") + "\n", { ndjson: true });
    for (const item of r.items ?? []) {
      if (item.index?.error) errors.push(item.index.error.reason);
      else indexed++;
    }
  }
  return { indexed, errors };
}

export async function esql(query, params) {
  return es("POST", "/_query?format=json", params ? { query, params } : { query });
}
