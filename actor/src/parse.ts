import { Readable, PassThrough, pipeline } from "node:stream";

const noop = () => {};
import { createGunzip } from "node:zlib";
import unzipper from "unzipper";
import { fastCsv, codeLineMatcher } from "./fastcsv.js";
import { jsonArrayItems, jsonCodeMatcher } from "./fastjson.js";
import type { ChargeRow } from "./types.js";
import { PROCEDURE_CODE_TYPES, normCode } from "./codes.js";
import { normalizePayer, planType } from "./payers.js";
import { num, str } from "./util.js";
import type { Budget } from "./budget.js";

export interface FileMeta {
  hospital_name: string | null;
  last_updated_on: string | null;
  version: string | null;
  location_names: string[];
  addresses: string[];
  format: "json" | "csv-tall" | "csv-wide" | "unknown";
  compression: string | null;
}

export interface ParseHandlers {
  codes: Set<string>;
  budget: Budget;
  onMeta: (m: FileMeta) => void;
  onRows: (rows: ChargeRow[]) => Promise<void>;
  onProgress?: (p: { items: number; matched: number }) => void;
}

/** Read the first chunk to detect compression and format, then hand back an equivalent stream. */
async function peek(stream: Readable): Promise<{ head: Buffer; stream: Readable }> {
  const it = stream[Symbol.asyncIterator]();
  const first = await it.next();
  const head: Buffer = first.done ? Buffer.alloc(0) : Buffer.from(first.value);
  const rest = Readable.from(
    (async function* () {
      if (head.length) yield head;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    })(),
    { objectMode: false },
  );
  return { head, stream: rest };
}

async function decompress(stream: Readable): Promise<{ stream: Readable; head: Buffer; note: string | null }> {
  let p = await peek(stream);
  if (p.head[0] === 0x1f && p.head[1] === 0x8b) {
    p = await peek(pipeline(p.stream, createGunzip(), noop));
    return { ...p, note: "gzip" };
  }
  if (p.head[0] === 0x50 && p.head[1] === 0x4b && p.head[2] === 0x03 && p.head[3] === 0x04) {
    const entryName = p.head.subarray(30, 30 + p.head.readUInt16LE(26)).toString("utf8");
    if (/\.(xlsx|xls)$/i.test(entryName) || entryName.startsWith("[Content_Types]")) {
      throw new Error(`price file is an Excel workbook (${entryName}); not supported yet`);
    }
    p = await peek(pipeline(p.stream, unzipper.ParseOne(), new PassThrough(), noop));
    return { ...p, note: `zip:${entryName}` };
  }
  return { ...p, note: null };
}

/** Parse one price file stream. Resolves when the file ends or the budget stops it. */
export async function parsePriceFile(raw: Readable, h: ParseHandlers): Promise<FileMeta> {
  const { stream, head, note } = await decompress(raw);
  const text = head.toString("utf8", 0, Math.min(head.length, 4096)).replace(/^﻿/, "").trimStart();
  const firstChar = text[0];
  if (firstChar === "{" || firstChar === "[") return parseJson(stream, h, note);
  if (firstChar === "<") throw new Error("got an HTML/XML page instead of a price file (blocked or moved?)");
  if (!firstChar) throw new Error("price file is empty");
  return parseCsv(stream, h, note);
}

const emptyMeta = (format: FileMeta["format"], compression: string | null): FileMeta => ({
  hospital_name: null,
  last_updated_on: null,
  version: null,
  location_names: [],
  addresses: [],
  format,
  compression,
});

const noPayer = {
  payer_name: null,
  plan_name: null,
  payer_normalized: null,
  plan_type: null,
  negotiated_dollar: null,
  negotiated_percentage: null,
  negotiated_algorithm: null,
  methodology: null,
  median_amount: null,
};

// ---------------- JSON (CMS template v2.x / v3.x) ----------------

const META_RE = {
  hospital_name: /"hospital_name"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  last_updated_on: /"last_updated_on"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  version: /"version"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  location_name: /"location_name"\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/,
  hospital_address: /"hospital_address"\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/,
};

function asList(jsonFrag: string | undefined): string[] {
  if (!jsonFrag) return [];
  try {
    const v = JSON.parse(jsonFrag);
    return (Array.isArray(v) ? v : [v]).map(String);
  } catch {
    return [];
  }
}

interface JsonPayer {
  payer_name?: string;
  plan_name?: string;
  standard_charge_dollar?: unknown;
  standard_charge_percentage?: unknown;
  standard_charge_algorithm?: unknown;
  methodology?: unknown;
  median_amount?: unknown;
  estimated_amount?: unknown;
}
interface JsonCharge {
  setting?: string;
  gross_charge?: unknown;
  discounted_cash?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  modifier_code?: string[] | string;
  payers_information?: JsonPayer[];
}
interface JsonItem {
  description?: string;
  code_information?: { code?: unknown; type?: string }[];
  standard_charges?: JsonCharge[];
}

async function parseJson(stream: Readable, h: ParseHandlers, compression: string | null): Promise<FileMeta> {
  // Metadata sits at the top of the file, before standard_charge_information; read it from the raw prefix.
  const meta = emptyMeta("json", compression);
  const fillMeta = (prefix: string) => {
    meta.hospital_name ??= prefix.match(META_RE.hospital_name)?.[1] ?? null;
    meta.last_updated_on ??= prefix.match(META_RE.last_updated_on)?.[1] ?? null;
    meta.version ??= prefix.match(META_RE.version)?.[1] ?? null;
    if (!meta.location_names.length) meta.location_names = asList(prefix.match(META_RE.location_name)?.[1]);
    if (!meta.addresses.length) meta.addresses = asList(prefix.match(META_RE.hospital_address)?.[1]);
  };

  let count = 0;
  let matched = 0;
  let metaSent = false;
  let batch: ChargeRow[] = [];
  const items = jsonArrayItems(stream, {
    key: "standard_charge_information",
    keep: jsonCodeMatcher(h.codes),
    onItem: () => void count++,
    onPrefix: fillMeta,
  });
  for await (const value of items as AsyncIterable<JsonItem>) {
    if (!metaSent) {
      metaSent = true;
      h.onMeta(meta);
    }
    const rows = jsonItemToRows(value, h.codes);
    if (rows.length) {
      matched++;
      batch.push(...rows);
      if (batch.length >= 500) {
        await h.onRows(batch);
        batch = [];
      }
    }
    h.onProgress?.({ items: count, matched });
    if (!h.budget.check()) break;
  }
  if (!metaSent) h.onMeta(meta);
  if (batch.length) await h.onRows(batch);
  h.onProgress?.({ items: count, matched });
  return meta;
}

function jsonItemToRows(item: JsonItem, codes: Set<string>): ChargeRow[] {
  const ci = (item.code_information ?? []).find(
    (c) => PROCEDURE_CODE_TYPES.has(String(c.type ?? "").toUpperCase()) && codes.has(normCode(c.code)),
  );
  if (!ci) return [];
  const code = normCode(ci.code);
  const code_type = String(ci.type).toUpperCase();
  const out: ChargeRow[] = [];
  for (const sc of item.standard_charges ?? []) {
    const base = {
      code,
      code_type,
      description: str(item.description),
      setting: str(sc.setting),
      modifiers: Array.isArray(sc.modifier_code) ? sc.modifier_code.join("|") || null : str(sc.modifier_code),
      gross_charge: num(sc.gross_charge),
      discounted_cash: num(sc.discounted_cash),
      min_negotiated: num(sc.minimum),
      max_negotiated: num(sc.maximum),
    };
    const payers = sc.payers_information ?? [];
    if (!payers.length) {
      out.push({ ...base, ...noPayer });
      continue;
    }
    for (const p of payers) {
      const payer_name = str(p.payer_name);
      const plan_name = str(p.plan_name);
      out.push({
        ...base,
        payer_name,
        plan_name,
        payer_normalized: normalizePayer(payer_name),
        plan_type: planType(payer_name, plan_name),
        negotiated_dollar: num(p.standard_charge_dollar),
        negotiated_percentage: num(p.standard_charge_percentage),
        negotiated_algorithm: str(p.standard_charge_algorithm),
        methodology: str(p.methodology),
        median_amount: num(p.median_amount ?? p.estimated_amount),
      });
    }
  }
  return out;
}

// ---------------- CSV (CMS template, tall or wide) ----------------

const nh = (s: string) =>
  String(s ?? "")
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\s*\|\s*/g, "|");

interface WideGroup {
  payer: string;
  plan: string | null;
  dollar?: number;
  pct?: number;
  algo?: number;
  method?: number;
  median?: number;
}

async function parseCsv(stream: Readable, h: ParseHandlers, compression: string | null): Promise<FileMeta> {
  const meta = emptyMeta("unknown", compression);
  // Lines without a target code are skipped before field parsing (see fastcsv.ts for why).
  let lines = 0;
  const rows = fastCsv(stream, { headerLines: 3, keep: codeLineMatcher(h.codes), onLine: () => void lines++ });

  let rowNo = 0;
  let metaHeader: string[] | null = null;
  let col: Record<string, number> = {};
  const codeCols: { code: number; type: number }[] = [];
  let groups: WideGroup[] = [];
  let tall = false;
  let headerDone = false;
  let count = 0;
  let lastReport = 0;
  let matched = 0;
  let batch: ChargeRow[] = [];

  const isColumnHeader = (r: string[]) =>
    r.some((c) => nh(c) === "description") && r.some((c) => /^code\|\d+$/.test(nh(c)));

  const setupHeader = (r: string[]) => {
    col = {};
    const wide = new Map<string, WideGroup>();
    r.forEach((orig, i) => {
      const n = nh(orig);
      col[n] ??= i;
      const m = n.match(/^code\|(\d+)$/);
      if (m) codeCols.push({ code: i, type: r.findIndex((x) => nh(x) === `code|${m[1]}|type`) });
      // Wide payer columns: standard_charge|<payer>|<plan>|<field>, median_amount|<payer>|<plan>
      const parts = String(orig).split("|").map((s) => s.trim());
      const p0 = parts[0]?.toLowerCase();
      let field: string | null = null;
      let payer: string | null = null;
      let plan: string | null = null;
      if (p0 === "standard_charge" && parts.length >= 4) {
        field = parts[parts.length - 1].toLowerCase();
        payer = parts[1];
        plan = parts.slice(2, -1).join(" | ") || null;
      } else if ((p0 === "median_amount" || p0 === "estimated_amount") && parts.length >= 3) {
        field = "median";
        payer = parts[1];
        plan = parts[2] ?? null;
      }
      if (field && payer) {
        // Kaiser wraps names in brackets: "[KAISER FOUNDATION HEALTH PLAN, INC.]"
        payer = payer.replace(/^\[(.*)\]$/, "$1").trim();
        plan = plan ? plan.replace(/^\[(.*)\]$/, "$1").trim() : plan;
        const key = `${payer}||${plan}`;
        const g = wide.get(key) ?? { payer, plan };
        if (field === "negotiated_dollar") g.dollar = i;
        else if (field === "negotiated_percentage") g.pct = i;
        else if (field === "negotiated_algorithm") g.algo = i;
        else if (field === "methodology") g.method = i;
        else if (field === "median") g.median = i;
        wide.set(key, g);
      }
    });
    tall = "payer_name" in col;
    groups = tall ? [] : [...wide.values()];
    meta.format = tall ? "csv-tall" : "csv-wide";
  };

  const csvRowToRows = (r: string[]): ChargeRow[] => {
    let code: string | null = null;
    let code_type = "";
    for (const cc of codeCols) {
      const t = String(r[cc.type] ?? "").trim().toUpperCase();
      const c = normCode(r[cc.code]);
      if (PROCEDURE_CODE_TYPES.has(t) && h.codes.has(c)) {
        code = c;
        code_type = t;
        break;
      }
    }
    if (!code) return [];
    const g = (k: string) => (col[k] !== undefined ? r[col[k]] : undefined);
    const base = {
      code,
      code_type,
      description: str(g("description")),
      setting: str(g("setting")),
      modifiers: str(g("modifiers")),
      gross_charge: num(g("standard_charge|gross")),
      discounted_cash: num(g("standard_charge|discounted_cash")),
      min_negotiated: num(g("standard_charge|min")),
      max_negotiated: num(g("standard_charge|max")),
    };
    if (tall) {
      const payer_name = str(g("payer_name"));
      const plan_name = str(g("plan_name"));
      if (!payer_name) return [{ ...base, ...noPayer }];
      return [
        {
          ...base,
          payer_name,
          plan_name,
          payer_normalized: normalizePayer(payer_name),
        plan_type: planType(payer_name, plan_name),
          negotiated_dollar: num(g("standard_charge|negotiated_dollar")),
          negotiated_percentage: num(g("standard_charge|negotiated_percentage")),
          negotiated_algorithm: str(g("standard_charge|negotiated_algorithm")),
          methodology: str(g("standard_charge|methodology")),
          median_amount: num(g("median_amount") ?? g("estimated_amount")),
        },
      ];
    }
    const out: ChargeRow[] = [];
    const at = (i?: number) => (i === undefined ? undefined : r[i]);
    for (const grp of groups) {
      const dollar = num(at(grp.dollar));
      const pct = num(at(grp.pct));
      const algo = str(at(grp.algo));
      if (dollar === null && pct === null && !algo) continue;
      out.push({
        ...base,
        payer_name: grp.payer,
        plan_name: grp.plan,
        payer_normalized: normalizePayer(grp.payer),
        plan_type: planType(grp.payer, grp.plan),
        negotiated_dollar: dollar,
        negotiated_percentage: pct,
        negotiated_algorithm: algo,
        methodology: str(at(grp.method)),
        median_amount: num(at(grp.median)),
      });
    }
    if (!out.length) out.push({ ...base, ...noPayer });
    return out;
  };

  for await (const r of rows as AsyncIterable<string[]>) {
    rowNo++;
    if (!headerDone) {
      if (isColumnHeader(r)) {
        setupHeader(r);
        headerDone = true;
        h.onMeta(meta);
      } else if (!metaHeader) {
        metaHeader = r.map(nh);
      } else {
        // Row 2 holds the general data element values.
        const get = (k: string) => {
          const i = metaHeader!.findIndex((x) => x === k || x.startsWith(k + "|"));
          return i >= 0 ? str(r[i]) : null;
        };
        meta.hospital_name = get("hospital_name");
        meta.last_updated_on = get("last_updated_on");
        meta.version = get("version");
        meta.location_names = (get("location_name") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
        meta.addresses = (get("hospital_address") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
      }
      if (rowNo > 10 && !headerDone) throw new Error("CSV column header not found in the first 10 rows (not a CMS template file?)");
      continue;
    }

    count = lines;
    const out = csvRowToRows(r);
    if (out.length) {
      matched++;
      batch.push(...out);
      if (batch.length >= 500) {
        await h.onRows(batch);
        batch = [];
      }
    }
    if (count - lastReport >= 20000) {
      lastReport = count;
      h.onProgress?.({ items: count, matched });
      if (!h.budget.check()) break;
    }
  }
  count = lines;
  if (batch.length) await h.onRows(batch);
  if (!headerDone) h.onMeta(meta);
  h.onProgress?.({ items: count, matched });
  return meta;
}
