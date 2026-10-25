// Verifies every API key in .env.local against its service. Prints OK/FAIL only, never secrets.
// Usage (repo root): node --env-file=.env.local scripts/check-keys.mjs
const e = process.env;
const t = (ms) => AbortSignal.timeout(ms);

async function check(name, fn) {
  try {
    const msg = await fn();
    console.log(`OK    ${name}${msg ? " - " + msg : ""}`);
  } catch (err) {
    console.log(`FAIL  ${name} - ${err.message}`);
  }
}
async function must(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}
const bd = (zone, url) =>
  fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${e.BRIGHTDATA_API_KEY}` },
    body: JSON.stringify({ zone, url, format: "raw" }),
    signal: t(60000),
  }).then(must);

await Promise.all([
  check("Anthropic", async () => {
    const r = await must(await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": e.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, signal: t(15000) }));
    const j = await r.json();
    return `${j.data.length} models visible`;
  }),
  check("Bright Data SERP", async () => {
    const r = await bd(e.BRIGHTDATA_SERP_ZONE, "https://www.google.com/search?q=UCSF+Health+price+transparency");
    const j = await r.json();
    return `${(j.organic || []).length} organic results, first: ${j.organic?.[0]?.link}`;
  }),
  check("Bright Data Unlocker", async () => {
    const r = await bd(e.BRIGHTDATA_UNLOCKER_ZONE, "https://www.ucsfhealth.org/cms-hpt.txt");
    const txt = await r.text();
    return `${txt.length} bytes, starts: ${JSON.stringify(txt.slice(0, 80))}`;
  }),
  check("Apify", async () => {
    const r = await must(await fetch("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${e.APIFY_TOKEN}` }, signal: t(15000) }));
    return `user ${(await r.json()).data.username}`;
  }),
  check("Elasticsearch", async () => {
    const r = await must(await fetch(e.ELASTIC_URL, {
      headers: { Authorization: `ApiKey ${e.ELASTIC_API_KEY}` }, signal: t(15000) }));
    const j = await r.json();
    return `${j.version?.build_flavor ?? ""} ${j.version?.number ?? ""}`;
  }),
  check("Kibana", async () => {
    const r = await must(await fetch(`${e.KIBANA_URL}/api/status`, {
      headers: { Authorization: `ApiKey ${e.ELASTIC_API_KEY}` }, signal: t(15000) }));
    return `status ${(await r.json()).status?.overall?.level}`;
  }),
  check("Cartesia", async () => {
    const r = await must(await fetch("https://api.cartesia.ai/voices", {
      headers: { "X-API-Key": e.CARTESIA_API_KEY, "Cartesia-Version": "2025-04-16" }, signal: t(15000) }));
    const j = await r.json();
    return `voices listed (${Array.isArray(j) ? j.length : (j.data?.length ?? "?")})`;
  }),
]);
