// Bright Data REST API: https://docs.brightdata.com (POST /request with zone + url + format=raw).
const ENDPOINT = "https://api.brightdata.com/request";

function cfg() {
  const key = process.env.BRIGHTDATA_API_KEY?.trim();
  return {
    key,
    serpZone: process.env.BRIGHTDATA_SERP_ZONE?.trim(),
    unlockerZone: process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim(),
  };
}

export function brightDataAvailable(): boolean {
  const c = cfg();
  return Boolean(c.key && c.unlockerZone);
}

function request(zone: string, url: string, signal: AbortSignal): Promise<Response> {
  const { key } = cfg();
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ zone, url, format: "raw" }),
    signal,
  });
}

/** Fetch any URL through Web Unlocker. Returns the streaming Response (check .ok). */
export async function unlockerFetch(url: string, timeoutMs = 90_000, outer?: AbortSignal): Promise<Response> {
  const { key, unlockerZone } = cfg();
  if (!key || !unlockerZone) throw new Error("Bright Data Unlocker not configured");
  const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const res = await request(unlockerZone, url, signal);
  if (!res.ok) throw new Error(`Bright Data Unlocker HTTP ${res.status} (${res.headers.get("x-brd-error") ?? ""})`);
  return res;
}

export interface SerpResult {
  title: string;
  link: string;
  description?: string;
}

/**
 * Google search via SERP API. SERP is sometimes slow (we measured 5-15s typical, occasional 45s+ hangs),
 * so we send two hedged requests and take the first good one, retrying up to `attempts` rounds.
 */
export async function serpSearch(query: string, attempts = 3, timeoutMs = 20_000): Promise<SerpResult[]> {
  const { key, serpZone } = cfg();
  if (!key || !serpZone) throw new Error("Bright Data SERP not configured");
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=us&hl=en`;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const one = async () => {
      const res = await request(serpZone, url, AbortSignal.any([ctrl.signal, AbortSignal.timeout(timeoutMs)]));
      const text = await res.text();
      if (!res.ok) throw new Error(`SERP HTTP ${res.status}`);
      const j = JSON.parse(text) as { organic?: SerpResult[] };
      if (!Array.isArray(j.organic)) throw new Error(`SERP returned no organic results (${res.headers.get("x-brd-error") ?? "unparsed"})`);
      return j.organic;
    };
    try {
      const out = await Promise.any([one(), one()]);
      ctrl.abort();
      return out;
    } catch (err) {
      ctrl.abort();
      lastErr = err instanceof AggregateError ? err.errors[0] : err;
    }
  }
  throw new Error(`Bright Data SERP failed after ${attempts} attempts: ${(lastErr as Error)?.message}`);
}
