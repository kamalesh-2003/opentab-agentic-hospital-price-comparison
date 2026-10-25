// Shared ingest logic (used by the CLI script and, later, by the Convex ingest job).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { es, bulk, INDEX } from "./lib.mjs";

const PROCS = Object.fromEntries(
  JSON.parse(readFileSync(new URL("./procedures.json", import.meta.url), "utf8")).map((p) => [p.code, p.label]),
);
const GEOCACHE = new URL("./geocache.json", import.meta.url);

/** "3/19/2026" | "2026-04-01" | "2026-04-01T..." -> "2026-04-01" (or null). */
export function isoDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---- Geocoding via OpenStreetMap Nominatim (free; 1 request/second; cached in geocache.json)
const cache = existsSync(GEOCACHE) ? JSON.parse(readFileSync(GEOCACHE, "utf8")) : {};
let lastCall = 0;

async function nominatim(q) {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "OpenTab/0.1 (Cal Hacks hospital price comparison)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : null;
}

export async function geocode(address, hospitalName) {
  const key = `${address ?? ""}|${hospitalName ?? ""}`;
  if (key in cache) return cache[key];
  const cleaned = (address ?? "").replace(/\b(box|suite|ste|unit|floor|fl|bldg|building|room|rm)\b\.?\s*[\w-]+,?/gi, "").replace(/\s+,/g, ",").trim();
  let loc = null;
  try {
    if (cleaned) loc = await nominatim(cleaned);
    // Drop the street number/name and try the hospital name + city as a fallback.
    if (!loc && hospitalName) loc = await nominatim(`${hospitalName}, ${cleaned.split(",").slice(-2).join(",")}`);
  } catch {
    loc = null;
  }
  cache[key] = loc;
  writeFileSync(GEOCACHE, JSON.stringify(cache, null, 1));
  return loc;
}

const docId = (r) =>
  createHash("sha1")
    .update([r.hospital_id, r.code, r.description, r.setting, r.modifiers, r.payer_name, r.plan_name, r.negotiated_dollar, r.negotiated_percentage].join("\u0001"))
    .digest("hex");

/** Index records grouped by hospital. Each hospital's previous prices are deleted first. */
export async function ingestRecords(records, { log = () => {}, via = null } = {}) {
  const byHospital = new Map();
  for (const r of records) {
    if (!byHospital.has(r.hospital_id)) byHospital.set(r.hospital_id, []);
    byHospital.get(r.hospital_id).push(r);
  }
  const hospitals = [];
  for (const [hospital_id, rows] of byHospital) {
    const first = rows[0];
    const location = first.location ?? (await geocode(first.address, first.hospital_name));
    const fileDate = isoDate(first.file_last_updated);
    const docs = rows.map((r) => ({
      _id: docId(r),
      ...r,
      location,
      procedure: PROCS[r.code] ?? null,
      file_last_updated: isoDate(r.file_last_updated),
      file_last_updated_raw: r.file_last_updated ?? null,
    }));
    await es("POST", `/${INDEX.prices}/_delete_by_query?refresh=true`, { query: { term: { hospital_id } } });
    const res = await bulk(INDEX.prices, docs);
    const h = {
      _id: hospital_id,
      hospital_id,
      hospital_name: first.hospital_name,
      hospital_location: first.hospital_location,
      address: first.address,
      location,
      hospital_domain: first.hospital_domain,
      source_url: first.source_url,
      source_page_url: first.source_page_url,
      file_last_updated: fileDate,
      file_version: first.file_version,
      ingested_at: first.ingested_at,
      partial: rows.some((r) => r.partial),
      record_count: res.indexed,
      codes: [...new Set(rows.map((r) => r.code))].sort(),
      payers: [...new Set(rows.map((r) => r.payer_normalized).filter(Boolean))].sort(),
      ingest_via: via,
    };
    await bulk(INDEX.hospitals, [h]);
    log(`${first.hospital_name}: ${res.indexed} prices indexed${res.errors.length ? `, ${res.errors.length} errors: ${res.errors[0]}` : ""}${location ? "" : " (no map location found)"}`);
    hospitals.push({ hospital_id, name: first.hospital_name, indexed: res.indexed, errors: res.errors.length, geocoded: Boolean(location) });
  }
  await es("POST", `/${INDEX.prices},${INDEX.hospitals}/_refresh`);
  return { hospitals, total: hospitals.reduce((a, h) => a + h.indexed, 0) };
}
