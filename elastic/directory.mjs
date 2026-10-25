// Build the US hospital directory used for "any location" discovery.
// Source: CMS Hospital General Information (data.cms.gov, dataset xubh-q36u) — every Medicare-certified hospital.
// Coordinates: US Census ZCTA gazetteer ZIP centroids (exact address geocoding happens at ingest time).
// Usage (repo root):
//   node --env-file=.env.local elastic/directory.mjs <path-to-YYYY_Gaz_zcta_national.txt>
//   (download: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip)
import { readFileSync } from "node:fs";
import { es, bulk } from "./lib.mjs";

const INDEX = "opentab-directory";
const gazPath = process.argv[2];
if (!gazPath) throw new Error("Pass the path to the Census ZCTA gazetteer .txt file");

// ZIP -> [lat, lon]
const zips = new Map();
for (const line of readFileSync(gazPath, "utf8").split(/\r?\n/).slice(1)) {
  const c = line.split("|");
  if (c.length >= 8) zips.set(c[0].trim(), [Number(c[6]), Number(c[7])]);
}
console.log(`ZIP centroids: ${zips.size}`);

// All CMS hospitals (paged API)
const rows = [];
for (let offset = 0; ; offset += 1500) {
  const res = await fetch(`https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?limit=1500&offset=${offset}`, {
    headers: { "User-Agent": "OpenTab/0.1 (Cal Hacks hospital price comparison)" }, // CMS returns 403 without one
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`CMS API HTTP ${res.status}`);
  const page = (await res.json()).results ?? [];
  rows.push(...page);
  if (page.length < 1500) break;
}
console.log(`CMS hospitals: ${rows.length}`);

const KEEP = /acute care|critical access|childrens/i;
const title = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/(^|[\s\-/(&.])(\w)/g, (_m, p, c) => p + c.toUpperCase())
    .replace(/\b(Ucsf|Uc|Ucla|Usc|Va|Hca|Llc|Inc)\b/g, (w) => w.toUpperCase());

const docs = [];
let noZip = 0;
for (const r of rows) {
  if (!KEEP.test(r.hospital_type ?? "")) continue;
  const z = zips.get(String(r.zip_code ?? "").slice(0, 5).padStart(5, "0"));
  if (!z) {
    noZip++;
    continue;
  }
  docs.push({
    _id: r.facility_id,
    facility_id: r.facility_id,
    name: title(r.facility_name),
    address: title(r.address),
    city: title(r.citytown),
    state: r.state,
    zip: r.zip_code,
    hospital_type: r.hospital_type,
    emergency_services: r.emergency_services === "Yes",
    location: { lat: z[0], lon: z[1] },
  });
}

const head = await fetch(`${process.env.ELASTIC_URL.trim().replace(/\/+$/, "")}/${INDEX}`, {
  method: "HEAD",
  headers: { Authorization: `ApiKey ${process.env.ELASTIC_API_KEY.trim()}` },
});
if (head.status !== 200) {
  await es("PUT", `/${INDEX}`, {
    mappings: {
      dynamic: "strict",
      properties: {
        facility_id: { type: "keyword" },
        name: { type: "text", fields: { raw: { type: "keyword" } } },
        address: { type: "text" },
        city: { type: "keyword" },
        state: { type: "keyword" },
        zip: { type: "keyword" },
        hospital_type: { type: "keyword" },
        emergency_services: { type: "boolean" },
        location: { type: "geo_point" },
      },
    },
  });
  console.log(`created ${INDEX}`);
}
const r = await bulk(INDEX, docs);
await es("POST", `/${INDEX}/_refresh`);
console.log(`directory: ${r.indexed} hospitals indexed, ${r.errors.length} errors, ${noZip} skipped (unknown ZIP)`);
