// Local test runner without the Apify platform.
// Usage: npx tsx --env-file=../.env.local src/local.ts '{"domain":"ucsfhealth.org"}' [out.json]
import { writeFileSync } from "node:fs";
import { ingest } from "./ingest.js";

const input = JSON.parse(process.argv[2] ?? '{"domain":"ucsfhealth.org"}');
const out = process.argv[3] ?? "local-output.json";
const { summary, records } = await ingest(input, { onStage: (s, d) => console.log(`[${s}] ${d}`) });
writeFileSync(out, JSON.stringify({ summary, sample: records.slice(0, 50), records }, null, 1));
console.log(JSON.stringify({ ...summary, log: summary.log.slice(-15) }, null, 2));
console.log(`wrote ${records.length} records to ${out}`);
