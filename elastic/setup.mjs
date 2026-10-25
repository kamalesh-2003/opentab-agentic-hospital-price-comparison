// Create OpenTab indices with explicit mappings, and load the procedures/synonyms index.
// Usage (repo root): node --env-file=.env.local elastic/setup.mjs [--reset]
import { readFileSync } from "node:fs";
import { es, bulk, INDEX } from "./lib.mjs";

const reset = process.argv.includes("--reset");
const kw = { type: "keyword" };
const textKw = { type: "text", fields: { raw: { type: "keyword", ignore_above: 512 } } };
const money = { type: "double" };

const mappings = {
  [INDEX.prices]: {
    dynamic: "strict",
    properties: {
      hospital_id: kw,
      hospital_name: textKw,
      hospital_location: kw,
      address: { type: "text" },
      location: { type: "geo_point" },
      hospital_domain: kw,
      source_url: { type: "keyword", index: false },
      source_page_url: { type: "keyword", index: false },
      file_last_updated: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
      file_last_updated_raw: kw,
      file_version: kw,
      ingested_at: { type: "date" },
      partial: { type: "boolean" },
      code: kw,
      code_type: kw,
      procedure: kw,
      description: textKw,
      setting: kw,
      modifiers: kw,
      gross_charge: money,
      discounted_cash: money,
      payer_name: textKw,
      payer_normalized: kw,
      plan_name: textKw,
      plan_type: kw,
      negotiated_dollar: money,
      negotiated_percentage: { type: "double" },
      negotiated_algorithm: { type: "text" },
      methodology: kw,
      median_amount: money,
      min_negotiated: money,
      max_negotiated: money,
    },
  },
  [INDEX.hospitals]: {
    dynamic: "strict",
    properties: {
      hospital_id: kw,
      hospital_name: textKw,
      hospital_location: kw,
      address: { type: "text" },
      location: { type: "geo_point" },
      hospital_domain: kw,
      source_url: { type: "keyword", index: false },
      source_page_url: { type: "keyword", index: false },
      file_last_updated: { type: "date", format: "strict_date_optional_time||yyyy-MM-dd" },
      file_version: kw,
      ingested_at: { type: "date" },
      partial: { type: "boolean" },
      record_count: { type: "integer" },
      codes: kw,
      payers: kw,
      ingest_via: kw,
    },
  },
  [INDEX.procedures]: {
    dynamic: "strict",
    properties: {
      code: kw,
      label: textKw,
      category: kw,
      synonyms: { type: "text" },
      plain_explanation: { type: "text" },
    },
  },
};

for (const [index, m] of Object.entries(mappings)) {
  const head = await fetch(`${process.env.ELASTIC_URL.trim().replace(/\/+$/, "")}/${index}`, {
    method: "HEAD",
    headers: { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}` },
  });
  if (head.status === 200 && reset) {
    await es("DELETE", `/${index}`);
    console.log(`deleted ${index}`);
  }
  if (head.status === 200 && !reset) {
    await es("PUT", `/${index}/_mapping`, m);
    console.log(`updated mapping ${index}`);
  } else {
    await es("PUT", `/${index}`, { mappings: m });
    console.log(`created ${index}`);
  }
}

const procs = JSON.parse(readFileSync(new URL("./procedures.json", import.meta.url), "utf8"));
const r = await bulk(INDEX.procedures, procs.map((p) => ({ _id: p.code, ...p })));
await es("POST", `/${INDEX.procedures}/_refresh`);
console.log(`procedures: ${r.indexed} indexed, ${r.errors.length} errors`, r.errors.slice(0, 3));
