// Index Actor output into Elastic (TypeScript port of elastic/ingest-lib.mjs, used by the live ADD flow).
import { es } from "./elastic";
import { PROCEDURES } from "./catalog";

type Rec = Record<string, unknown> & { hospital_id: string; hospital_name: string; code: string };

export function isoDate(s: unknown): string | null {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function nominatim(q: string): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "OpenTab/0.1 (Cal Hacks hospital price comparison)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { lat: string; lon: string }[];
  return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : null;
}

export async function geocode(address: string | null, name: string): Promise<{ lat: number; lon: number } | null> {
  const cleaned = (address ?? "")
    .replace(/\b(box|suite|ste|unit|floor|fl|bldg|building|room|rm)\b\.?\s*[\w-]+,?/gi, "")
    .replace(/\s+,/g, ",")
    .trim();
  try {
    let loc = cleaned ? await nominatim(cleaned) : null;
    if (!loc) {
      await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max 1 request/second
      loc = await nominatim(`${name}, ${cleaned.split(",").slice(-2).join(",")}`);
    }
    return loc;
  } catch {
    return null;
  }
}

// Same id recipe as elastic/ingest-lib.mjs (sha1 of the row's identity), via Web Crypto so it
// bundles in any Convex runtime.
async function docId(r: Rec): Promise<string> {
  const key = [r.hospital_id, r.code, r.description, r.setting, r.modifiers, r.payer_name, r.plan_name, r.negotiated_dollar, r.negotiated_percentage].join("\u0001");
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bulk(index: string, docs: Record<string, unknown>[]) {
  let indexed = 0;
  for (let i = 0; i < docs.length; i += 2000) {
    const lines: string[] = [];
    for (const { _id, ...doc } of docs.slice(i, i + 2000)) lines.push(JSON.stringify({ index: { _index: index, _id } }), JSON.stringify(doc));
    const r = await es("POST", "/_bulk", lines.join("\n") + "\n", true);
    for (const item of r.items ?? []) if (!item.index?.error) indexed++;
  }
  return indexed;
}

/** Replace each hospital's prices with these records. Returns per-hospital counts. */
export async function indexRecords(records: Rec[], via: string) {
  const byHospital = new Map<string, Rec[]>();
  for (const r of records) {
    if (!byHospital.has(r.hospital_id)) byHospital.set(r.hospital_id, []);
    byHospital.get(r.hospital_id)!.push(r);
  }
  const out: { hospitalId: string; name: string; indexed: number; location: { lat: number; lon: number } | null }[] = [];
  for (const [hospital_id, rows] of byHospital) {
    const first = rows[0];
    const location = await geocode((first.address as string) ?? null, first.hospital_name);
    const docs = await Promise.all(rows.map(async (r) => ({
      _id: await docId(r),
      ...r,
      location,
      procedure: (PROCEDURES as Record<string, { long: string }>)[r.code]?.long ?? null,
      file_last_updated: isoDate(r.file_last_updated),
      file_last_updated_raw: (r.file_last_updated as string) ?? null,
    })));
    await es("POST", `/opentab-prices/_delete_by_query?refresh=true`, { query: { term: { hospital_id } } });
    const indexed = await bulk("opentab-prices", docs);
    await bulk("opentab-hospitals", [
      {
        _id: hospital_id,
        hospital_id,
        hospital_name: first.hospital_name,
        hospital_location: first.hospital_location ?? null,
        address: first.address ?? null,
        location,
        hospital_domain: first.hospital_domain ?? null,
        source_url: first.source_url ?? null,
        source_page_url: first.source_page_url ?? null,
        file_last_updated: isoDate(first.file_last_updated),
        file_version: first.file_version ?? null,
        ingested_at: first.ingested_at ?? new Date().toISOString(),
        partial: rows.some((r) => r.partial),
        record_count: indexed,
        codes: [...new Set(rows.map((r) => r.code))].sort(),
        payers: [...new Set(rows.map((r) => r.payer_normalized as string).filter(Boolean))].sort(),
        ingest_via: via,
      },
    ]);
    out.push({ hospitalId: hospital_id, name: first.hospital_name, indexed, location });
  }
  await es("POST", "/opentab-prices,opentab-hospitals/_refresh");
  return out;
}
