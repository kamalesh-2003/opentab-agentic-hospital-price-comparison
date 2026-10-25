import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Fast streaming reader for the items of one top-level JSON array (e.g. "standard_charge_information").
 * A token-level JSON parser runs ~4 MB/s on CMS files. Here a string-aware brace scanner finds each item's
 * text boundaries, and only items whose raw text passes `keep()` are JSON.parse'd. Memory stays bounded by
 * the largest single item.
 */
export async function* jsonArrayItems(
  stream: Readable,
  opts: { key: string; keep: (rawItem: string) => boolean; onItem?: () => void; onPrefix?: (text: string) => void },
): AsyncGenerator<unknown> {
  const dec = new StringDecoder("utf8");
  const keyToken = `"${opts.key}"`;
  let buf = "";
  let pos = 0; // scan position in buf
  let phase = "seek" as "seek" | "array" | "done";
  let itemStart = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let first = true;

  for await (const chunk of stream) {
    let text = dec.write(chunk as Buffer);
    if (first) {
      first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    buf += text;

    if (phase === "seek") {
      const k = buf.indexOf(keyToken);
      if (k < 0) {
        opts.onPrefix?.(buf);
        // Keep a tail in case the key spans chunks; metadata prefix is reported above.
        if (buf.length > 5_000_000) buf = buf.slice(-1000);
        continue;
      }
      opts.onPrefix?.(buf.slice(0, k));
      const br = buf.indexOf("[", k + keyToken.length);
      if (br < 0) continue;
      pos = br + 1;
      phase = "array";
    }

    // Scan items.
    const n = buf.length;
    let i = pos;
    while (i < n) {
      const c = buf.charCodeAt(i);
      if (itemStart < 0) {
        if (c === 123 /* { */) {
          itemStart = i;
          depth = 1;
          inStr = false;
          esc = false;
        } else if (c === 93 /* ] */) {
          phase = "done";
          break;
        }
        i++;
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92 /* \ */) esc = true;
        else if (c === 34 /* " */) inStr = false;
        i++;
        continue;
      }
      if (c === 34) inStr = true;
      else if (c === 123 || c === 91) depth++;
      else if (c === 125 || c === 93) {
        depth--;
        if (depth === 0) {
          const raw = buf.slice(itemStart, i + 1);
          itemStart = -1;
          opts.onItem?.();
          if (opts.keep(raw)) yield JSON.parse(raw);
        }
      }
      i++;
    }
    // Drop consumed text; keep the partial item (if any).
    const keepFrom = itemStart >= 0 ? itemStart : i;
    buf = buf.slice(keepFrom);
    if (itemStart >= 0) itemStart = 0;
    pos = i - keepFrom;
    if (buf.length > 200_000_000) throw new Error("single JSON item larger than 200 MB");
    if (phase === "done") break;
  }
  if (phase === "seek") throw new Error(`no "${opts.key}" array found in JSON file`);
}

/** Matches an item that has `"code": "<target>"` for any target code. */
export function jsonCodeMatcher(codes: Iterable<string>): (raw: string) => boolean {
  const alts = [...codes].map((c) => c.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  const re = new RegExp(`"code"\\s*:\\s*"?\\s*(?:${alts.join("|")})\\s*"?\\s*[,}]`);
  return (raw) => re.test(raw);
}
