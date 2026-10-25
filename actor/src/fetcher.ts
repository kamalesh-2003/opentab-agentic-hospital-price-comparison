import { Readable } from "node:stream";
import { brightDataAvailable, unlockerFetch } from "./brightdata.js";

const UA = "Mozilla/5.0 (compatible; OpenTab/0.1; +https://github.com/kamalesh-2003/opentab-agentic-hospital-price-comparison)";

export type Via = "direct" | "brightdata";

export interface Opened {
  body: Readable;
  via: Via;
  contentType: string;
  contentLength: number | null;
  finalUrl: string;
  /** Notes on what was tried (e.g. "direct: HTTP 403"), for honest error reporting. */
  notes: string[];
}

function looksBlocked(res: Response): string | null {
  if (!res.ok) return `HTTP ${res.status}`;
  return null;
}

/**
 * Open a URL as a stream. Direct fetch first; if it errors, times out, or looks blocked,
 * retry through Bright Data Web Unlocker. With `expectHtmlOk=false`, an HTML page counts as a block page.
 */
export async function openUrl(
  url: string,
  opts: { headerTimeoutMs?: number; expectHtmlOk?: boolean; signal?: AbortSignal } = {},
): Promise<Opened> {
  const notes: string[] = [];
  const headerTimeoutMs = opts.headerTimeoutMs ?? 20_000;

  // 1) Direct
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout waiting for response headers")), headerTimeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow", signal });
    clearTimeout(timer);
    const blocked = looksBlocked(res);
    const ct = res.headers.get("content-type") ?? "";
    if (!blocked && !(ct.includes("text/html") && !opts.expectHtmlOk) && res.body) {
      return {
        body: Readable.fromWeb(res.body as never),
        via: "direct",
        contentType: ct,
        contentLength: num(res.headers.get("content-length")),
        finalUrl: res.url || url,
        notes,
      };
    }
    notes.push(`direct: ${blocked ?? `got HTML (${ct}) instead of a file`}`);
    res.body?.cancel().catch(() => {});
    // A clean 404/410 means "not here"; an unblocker would only waste time and credits.
    if (res.status === 404 || res.status === 410) throw new NotFound(`${url}: HTTP ${res.status}`);
  } catch (err) {
    if (err instanceof NotFound) throw err;
    notes.push(`direct: ${(err as Error).message}`);
  }
  if (opts.signal?.aborted) throw new Error("aborted");

  // 2) Bright Data Web Unlocker fallback
  if (!brightDataAvailable()) throw new Error(`Fetch failed and Bright Data is not configured. ${notes.join("; ")}`);
  try {
    const res = await unlockerFetch(url, 90_000, opts.signal);
    return {
      body: Readable.fromWeb(res.body as never),
      via: "brightdata",
      contentType: res.headers.get("content-type") ?? "",
      contentLength: num(res.headers.get("content-length")),
      finalUrl: url,
      notes,
    };
  } catch (err) {
    notes.push(`brightdata: ${(err as Error).message}`);
    throw new Error(`Could not fetch ${url}. ${notes.join("; ")}`);
  }
}

/** Fetch a small text resource fully (e.g. cms-hpt.txt), with the same fallback. */
export async function fetchText(url: string, maxBytes = 2_000_000): Promise<{ text: string; via: Via; notes: string[] }> {
  const o = await openUrl(url, { expectHtmlOk: false });
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of o.body) {
    chunks.push(c as Buffer);
    n += (c as Buffer).length;
    if (n > maxBytes) {
      o.body.destroy();
      break;
    }
  }
  return { text: decodeText(Buffer.concat(chunks)), via: o.via, notes: o.notes };
}

/** cms-hpt.txt files show up as UTF-8, UTF-8 with BOM, and UTF-16 (Sutter). */
export function decodeText(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString("utf16le");
  // UTF-16 without a BOM: every other byte is zero for ASCII text.
  if (b.length > 8 && b[1] === 0 && b[3] === 0 && b[5] === 0) return b.toString("utf16le");
  return b.toString("utf8").replace(/^﻿/, "");
}

export class NotFound extends Error {}

function num(v: string | null): number | null {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
