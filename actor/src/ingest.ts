import { pipeline } from "node:stream";
import { Budget, BudgetStop } from "./budget.js";
import { discoverFromDomain, discoverFromName, type HptEntry } from "./discover.js";
import { openUrl, type Via } from "./fetcher.js";
import { parsePriceFile, type FileMeta } from "./parse.js";
import { TARGET_CODES, normCode } from "./codes.js";
import type { ChargeRow, FileContext, PriceRecord } from "./types.js";
import { domainOf, slug } from "./util.js";

export interface IngestInput {
  hospitalName?: string;
  domain?: string;
  fileUrl?: string;
  /** Only use cms-hpt.txt entries whose location-name contains this text (case-insensitive). */
  locationFilter?: string;
  codes?: string[];
  timeBudgetSec?: number;
  byteBudgetMb?: number;
  maxFiles?: number;
  /** Keep at most this many records in memory/output (safety cap). */
  maxRecords?: number;
}

export type Stage = "searching" | "fetching" | "parsing" | "done" | "failed";

export interface FileReport {
  url: string;
  location_name: string | null;
  via: Via | null;
  format: FileMeta["format"] | null;
  compression: string | null;
  version: string | null;
  last_updated: string | null;
  hospital_name: string | null;
  bytes: number;
  items_scanned: number;
  items_matched: number;
  records: number;
  partial: boolean;
  stop_reason: string | null;
  error: string | null;
}

export interface IngestSummary {
  status: "ok" | "partial" | "empty" | "failed";
  message: string;
  domain: string | null;
  hpt_url: string | null;
  records: number;
  codes_found: string[];
  files: FileReport[];
  elapsed_sec: number;
  log: string[];
}

export interface IngestCallbacks {
  onStage?: (stage: Stage, detail: string) => Promise<void> | void;
}

export async function ingest(
  input: IngestInput,
  cb: IngestCallbacks = {},
): Promise<{ summary: IngestSummary; records: PriceRecord[] }> {
  const log: string[] = [];
  const stage = async (s: Stage, d: string) => {
    log.push(`[${s}] ${d}`);
    await cb.onStage?.(s, d);
  };
  const codes = new Set((input.codes?.length ? input.codes : Object.keys(TARGET_CODES)).map(normCode));
  const budget = new Budget((input.timeBudgetSec ?? 60) * 1000, (input.byteBudgetMb ?? 500) * 1e6);
  const maxFiles = input.maxFiles ?? 3;
  const maxRecords = input.maxRecords ?? 300_000;
  const records: PriceRecord[] = [];
  const files: FileReport[] = [];
  let domain: string | null = input.domain ?? null;
  let hptUrl: string | null = null;

  const finish = (status: IngestSummary["status"], message: string) => ({
    summary: {
      status,
      message,
      domain,
      hpt_url: hptUrl,
      records: records.length,
      codes_found: [...new Set(records.map((r) => r.code))].sort(),
      files,
      elapsed_sec: Math.round(budget.elapsedMs / 100) / 10,
      log,
    },
    records,
  });

  // ---- 1. Find the price file(s)
  let entries: HptEntry[] = [];
  try {
    if (input.fileUrl) {
      entries = [{ location_name: input.hospitalName ?? null, source_page_url: null, mrf_url: input.fileUrl }];
      domain ??= domainOf(input.fileUrl);
      await stage("searching", `Using the price file URL provided`);
    } else {
      await stage("searching", `Looking for ${input.domain ?? input.hospitalName}'s cms-hpt.txt`);
      let found = input.domain ? await discoverFromDomain(input.domain, log) : null;
      if (!found && input.hospitalName) {
        await stage("searching", `Searching the web for ${input.hospitalName}'s official site (Bright Data SERP)`);
        found = await discoverFromName(input.hospitalName, log);
      }
      if (!found) {
        return finish(
          "failed",
          `Could not find a cms-hpt.txt price file index for ${input.domain ?? input.hospitalName}. ` +
            `The hospital may not publish one at its root domain yet.`,
        );
      }
      domain = found.domain;
      hptUrl = found.hptUrl;
      entries = found.entries;
    }
  } catch (err) {
    return finish("failed", `Search failed: ${(err as Error).message}`);
  }

  if (input.locationFilter) {
    const f = input.locationFilter.toLowerCase();
    const filtered = entries.filter((e) => (e.location_name ?? "").toLowerCase().includes(f));
    log.push(`locationFilter "${input.locationFilter}": ${filtered.length}/${entries.length} entries`);
    if (filtered.length) entries = filtered;
  }
  else if (input.hospitalName && entries.length > maxFiles) {
    // Big systems list dozens of locations (Kaiser: 41). Keep those whose name best matches what was asked.
    const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const want = words(input.hospitalName);
    const score = (e: HptEntry) => [...words(e.location_name ?? "")].filter((w) => want.has(w)).length;
    const best = Math.max(...entries.map(score));
    if (best > 0) {
      const picked = entries.filter((e) => score(e) === best);
      log.push(`Picked ${picked.length}/${entries.length} locations matching "${input.hospitalName}": ${picked.map((e) => e.location_name).join("; ").slice(0, 200)}`);
      entries = picked;
    }
  }
  // Several locations often share one file.
  const byUrl = new Map<string, HptEntry & { names: string[] }>();
  for (const e of entries) {
    const cur = byUrl.get(e.mrf_url);
    if (cur) cur.names.push(e.location_name ?? "");
    else byUrl.set(e.mrf_url, { ...e, names: [e.location_name ?? ""] });
  }
  const unique = [...byUrl.values()].slice(0, maxFiles);
  log.push(`${byUrl.size} unique price file(s); processing ${unique.length}`);

  // ---- 2. Fetch + parse each file
  for (const [i, e] of unique.entries()) {
    if (!budget.check()) break;
    const rep: FileReport = {
      url: e.mrf_url,
      location_name: e.location_name,
      via: null,
      format: null,
      compression: null,
      version: null,
      last_updated: null,
      hospital_name: null,
      bytes: 0,
      items_scanned: 0,
      items_matched: 0,
      records: 0,
      partial: false,
      stop_reason: null,
      error: null,
    };
    files.push(rep);
    const startBytes = budget.bytes;
    const fileRecords: PriceRecord[] = [];
    let ctx: FileContext | null = null;
    let lastProgress = 0;
    try {
      await stage("fetching", `Downloading price file ${i + 1}/${unique.length}${e.location_name ? ` (${e.location_name})` : ""}`);
      const opened = await openUrl(e.mrf_url, { headerTimeoutMs: 30_000, signal: budget.ctrl.signal });
      rep.via = opened.via;
      log.push(...opened.notes.map((n) => `${e.mrf_url.slice(0, 80)} ${n}`));
      const sizeMb = opened.contentLength ? `${Math.round(opened.contentLength / 1e6)} MB` : "unknown size";
      await stage("parsing", `Streaming ${sizeMb} file via ${opened.via === "direct" ? "direct download" : "Bright Data Unlocker"}`);

      const counted = pipeline(opened.body, budget.counter(), () => {});
      const meta = await parsePriceFile(counted, {
        codes,
        budget,
        onMeta: (m) => {
          rep.format = m.format;
          rep.compression = m.compression;
          rep.version = m.version;
          rep.last_updated = m.last_updated_on;
          rep.hospital_name = m.hospital_name;
          const name = cleanName(m.hospital_name) ?? e.location_name ?? input.hospitalName ?? domain ?? "Unknown hospital";
          ctx = {
            hospital_id: slug(`${domain ?? ""}-${name}`),
            hospital_name: name,
            hospital_location: m.location_names[0] ?? e.location_name ?? null,
            address: m.addresses[0] ?? null,
            hospital_domain: domain,
            source_url: e.mrf_url,
            source_page_url: e.source_page_url,
            file_last_updated: m.last_updated_on,
            file_version: m.version,
            ingested_at: new Date().toISOString(),
          };
        },
        onRows: async (rows: ChargeRow[]) => {
          for (const r of rows) {
            if (records.length + fileRecords.length >= maxRecords) {
              budget.stop(`record cap of ${maxRecords} reached`);
              break;
            }
            fileRecords.push({ ...ctx!, ...r, location: null, partial: false });
          }
        },
        onProgress: async (p) => {
          rep.items_scanned = p.items;
          rep.items_matched = p.matched;
          if (Date.now() - lastProgress > 3000) {
            lastProgress = Date.now();
            await stage(
              "parsing",
              `${Math.round((budget.bytes - startBytes) / 1e6)} MB read, ${p.items.toLocaleString()} items scanned, ${fileRecords.length.toLocaleString()} prices found`,
            );
          }
        },
      });
      void meta;
      counted.destroy();
    } catch (err) {
      if (err instanceof BudgetStop || budget.stoppedReason) {
        rep.stop_reason = budget.stoppedReason;
      } else {
        rep.error = (err as Error).message;
        log.push(`ERROR ${e.mrf_url.slice(0, 80)}: ${rep.error}`);
      }
    }
    rep.bytes = budget.bytes - startBytes;
    if (budget.stoppedReason) {
      rep.partial = true;
      rep.stop_reason = budget.stoppedReason;
    }
    for (const r of fileRecords) r.partial = rep.partial;
    rep.records = fileRecords.length;
    // Some hospitals list several URLs that serve the same file; skip exact duplicates.
    const dup = files.find(
      (f) =>
        f !== rep &&
        !f.error &&
        f.hospital_name === rep.hospital_name &&
        f.last_updated === rep.last_updated &&
        Math.abs(f.bytes - rep.bytes) <= Math.max(f.bytes, rep.bytes) * 0.001 &&
        f.items_scanned === rep.items_scanned &&
        f.records === rep.records,
    );
    if (dup && rep.records) {
      rep.error = `same prices as ${dup.hospital_name ?? dup.url.slice(0, 80)}'s file; skipped as duplicate`;
      log.push(`${rep.hospital_name}: ${rep.error}`);
      rep.records = 0;
      continue;
    }
    records.push(...fileRecords);
  }

  // Systems like John Muir name every file "John Muir Health"; give each file its own hospital
  // using the cms-hpt.txt location name so Walnut Creek and Concord stay separate.
  const idFiles = new Map<string, Set<string>>();
  for (const r of records) {
    if (!idFiles.has(r.hospital_id)) idFiles.set(r.hospital_id, new Set());
    idFiles.get(r.hospital_id)!.add(r.source_url);
  }
  const locByUrl = new Map(unique.map((e) => [e.mrf_url, e.location_name]));
  for (const r of records) {
    const loc = locByUrl.get(r.source_url);
    if ((idFiles.get(r.hospital_id)?.size ?? 0) > 1 && loc) {
      r.hospital_name = cleanName(loc) ?? r.hospital_name;
      r.hospital_location = loc;
      r.hospital_id = slug(`${domain ?? ""}-${loc}`);
    }
  }

  // ---- 3. Summarize honestly
  const errs = files.filter((f) => f.error);
  const partial = files.some((f) => f.partial) || unique.length < byUrl.size;
  if (!records.length) {
    if (errs.length === files.length && files.length) {
      return finish("failed", `Found the price file but could not read it: ${errs[0].error}`);
    }
    return finish(
      "empty",
      partial
        ? `Read part of the file before the ${budget.stoppedReason ?? "budget"} and found none of the target procedures yet.`
        : `The price file has none of the target procedure codes.`,
    );
  }
  const found = [...new Set(records.map((r) => r.code))].length;
  const msg = `${records.length.toLocaleString()} prices for ${found} procedures` + (partial ? ` (partial: ${budget.stoppedReason ?? "not all files processed"})` : "");
  await stage("done", msg);
  return finish(partial ? "partial" : "ok", msg);
}

function cleanName(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  // Some files shout or use lower case; title-case when the whole name is one case.
  if (t === t.toUpperCase() || t === t.toLowerCase()) {
    // Capitalize after spaces/punctuation but not after apostrophes ("Children's", not "Children'S").
    return t
      .toLowerCase()
      .replace(/(^|[\s\-/(&])(\w)/g, (_m, p: string, c: string) => p + c.toUpperCase())
      .replace(/\bUcsf\b/g, "UCSF");
  }
  return t.replace(/\bUcsf\b/g, "UCSF");
}
