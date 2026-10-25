// Load Actor output into Elastic. Replaces each hospital's prices, so re-runs never duplicate.
// Usage (repo root):
//   node --env-file=.env.local elastic/ingest.mjs --file out.json [--file more.json]
//   node --env-file=.env.local elastic/ingest.mjs --dataset <apifyDatasetId>
//   node --env-file=.env.local elastic/ingest.mjs --run <apifyRunId>
import { readFileSync } from "node:fs";
import { ingestRecords } from "./ingest-lib.mjs";

const args = process.argv.slice(2);
const take = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));

let records = [];
for (const f of take("--file")) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  records.push(...(Array.isArray(j) ? j : j.records));
}
for (const id of take("--dataset")) records.push(...(await datasetItems(id)));
for (const runId of take("--run")) {
  const run = await apify(`/v2/actor-runs/${runId}`);
  records.push(...(await datasetItems(run.data.defaultDatasetId)));
}
if (!records.length) {
  console.error("No records. Pass --file, --dataset or --run.");
  process.exit(1);
}

const result = await ingestRecords(records, { log: console.log });
console.log(JSON.stringify(result, null, 2));

async function apify(path) {
  const res = await fetch(`https://api.apify.com${path}`, { headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN.trim()}` } });
  if (!res.ok) throw new Error(`Apify ${path}: HTTP ${res.status}`);
  return res.json();
}

async function datasetItems(id) {
  const out = [];
  for (let offset = 0; ; offset += 5000) {
    const res = await fetch(`https://api.apify.com/v2/datasets/${id}/items?clean=true&format=json&limit=5000&offset=${offset}`, {
      headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN.trim()}` },
    });
    if (!res.ok) throw new Error(`Apify dataset ${id}: HTTP ${res.status}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 5000) return out;
  }
}
