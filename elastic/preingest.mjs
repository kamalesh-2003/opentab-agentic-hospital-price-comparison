// Pre-ingest the Bay Area hospital list into Elastic.
//   --apify : run each hospital on the Apify platform (deployed Actor), then index its dataset  [default]
//   --local : run the Actor code locally with tsx (for development)
// Usage (repo root): node --env-file=.env.local elastic/preingest.mjs [--local] [--only <text>] [--concurrency 3]
import { readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ingestRecords } from "./ingest-lib.mjs";

const args = process.argv.slice(2);
const local = args.includes("--local");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].toLowerCase() : null;
const concurrency = args.includes("--concurrency") ? Number(args[args.indexOf("--concurrency") + 1]) : 3;
const list = JSON.parse(readFileSync(new URL("./hospitals.json", import.meta.url), "utf8")).filter(
  (h) => !only || JSON.stringify(h.input).toLowerCase().includes(only),
);
const ACTOR = `${process.env.APIFY_USERNAME?.trim()}~hospital-price-transparency-parser`;
const label = (i) => i.hospitalName ?? `${i.domain}${i.locationFilter ? ` [${i.locationFilter}]` : ""}`;

async function runLocal(input, n) {
  const outDir = new URL("../actor/storage/preingest/", import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const out = new URL(`./run-${n}.json`, outDir);
  await new Promise((resolve, reject) => {
    // Run tsx's CLI through node directly (no shell), so the JSON argument survives on Windows.
    const actorDir = new URL("../actor/", import.meta.url);
    const tsxCli = new URL("node_modules/tsx/dist/cli.mjs", actorDir);
    const p = spawn(process.execPath, [fileURLToPath(tsxCli), "--env-file=../.env.local", "src/local.ts", JSON.stringify(input), fileURLToPath(out)], {
      cwd: actorDir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`local run exited ${code}`))));
  });
  const j = JSON.parse(readFileSync(out, "utf8"));
  return { summary: j.summary, records: j.records, via: "local" };
}

async function apify(path, init) {
  const res = await fetch(`https://api.apify.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN.trim()}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Apify ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runApify(input) {
  const budget = (input.timeBudgetSec ?? 60) + 240;
  const { data: run } = await apify(`/v2/acts/${ACTOR}/runs?timeout=${budget}&memory=2048`, { method: "POST", body: JSON.stringify(input) });
  let r = run;
  while (["READY", "RUNNING"].includes(r.status)) {
    await new Promise((s) => setTimeout(s, 5000));
    r = (await apify(`/v2/actor-runs/${run.id}`)).data;
  }
  const summary = (await apify(`/v2/key-value-stores/${r.defaultKeyValueStoreId}/records/OUTPUT`).catch(() => null)) ?? { status: r.status, message: r.statusMessage };
  const records = [];
  for (let offset = 0; ; offset += 5000) {
    const page = await apify(`/v2/datasets/${r.defaultDatasetId}/items?clean=true&limit=5000&offset=${offset}`);
    records.push(...page);
    if (page.length < 5000) break;
  }
  return { summary, records, via: `apify run ${run.id}` };
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (next < list.length) {
      const n = next++;
      const input = { timeBudgetSec: 180, byteBudgetMb: 1500, ...list[n].input };
      const t0 = Date.now();
      try {
        const { summary, records, via } = local ? await runLocal(input, n) : await runApify(input);
        const ing = records.length ? await ingestRecords(records, { via: local ? "local" : "apify" }) : { total: 0, hospitals: [] };
        const line = `${label(input)}: ${summary.status} - ${summary.message} -> ${ing.total} indexed (${ing.hospitals.map((h) => h.name).join(", ")}) [${via}, ${Math.round((Date.now() - t0) / 1000)}s]`;
        console.log(line);
        results.push(line);
      } catch (err) {
        const line = `${label(input)}: ERROR ${err.message}`;
        console.log(line);
        results.push(line);
      }
    }
  }),
);
console.log(`\nDone: ${results.length} hospitals processed.`);
