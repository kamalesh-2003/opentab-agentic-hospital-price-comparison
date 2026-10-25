import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Fast CSV reader for huge CMS price files.
 * csv-parse runs ~2 MB/s on these files; here we split logical lines quickly (respecting quoted newlines)
 * and only fully parse the first `headerLines` lines plus lines that pass `keep(line)`.
 * Yields { fields, lineNo } for parsed lines and counts skipped ones via `onSkip`.
 */
export async function* fastCsv(
  stream: Readable,
  opts: { headerLines: number; keep: (rawLine: string) => boolean; onLine?: () => void },
): AsyncGenerator<string[]> {
  const dec = new StringDecoder("utf8");
  let carry = "";
  let lineNo = 0;
  let first = true;

  const emit = function* (line: string): Generator<string[]> {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line) return;
    lineNo++;
    opts.onLine?.();
    if (lineNo <= opts.headerLines || opts.keep(line)) yield splitCsvLine(line);
  };

  for await (const chunk of stream) {
    let text = carry + dec.write(chunk as Buffer);
    if (first) {
      first = false;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    let start = 0;
    let inQuote = false;
    let i = 0;
    // A quote only opens a quoted field at the start of a field (after a comma or line start);
    // stray quotes inside unquoted fields (e.g. 12" x 12") are literal, like csv-parse relax_quotes.
    for (;;) {
      if (inQuote) {
        const q = text.indexOf('"', i);
        if (q < 0) break;
        if (text.charCodeAt(q + 1) === 34) {
          i = q + 2; // escaped ""
          continue;
        }
        if (q + 1 >= text.length) break; // need the next char to decide
        inQuote = false;
        i = q + 1;
        continue;
      }
      const nl = text.indexOf("\n", i);
      if (nl < 0) break;
      // Find a field-opening quote before this newline.
      let q = text.indexOf('"', i);
      while (q >= 0 && q < nl) {
        const prev = q === start ? 44 : text.charCodeAt(q - 1);
        if (prev === 44 /* , */ || q === start) break;
        q = text.indexOf('"', q + 1);
      }
      if (q >= 0 && q < nl) {
        inQuote = true;
        i = q + 1;
        continue;
      }
      yield* emit(text.slice(start, nl));
      start = nl + 1;
      i = start;
    }
    carry = text.slice(start);
    // Guard against a runaway unterminated quote eating memory.
    if (carry.length > 50_000_000) throw new Error("CSV line longer than 50 MB (malformed quotes?)");
  }
  carry += dec.end();
  if (carry) yield* emit(carry);
}

/** RFC 4180 field split for one logical line. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line.charCodeAt(i) === 34 /* " */) {
      let val = "";
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) {
          val += line.slice(i);
          i = n + 1;
          break;
        }
        val += line.slice(i, q);
        if (line.charCodeAt(q + 1) === 34) {
          val += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // Skip to next comma (tolerates junk after a closing quote).
      const c = line.indexOf(",", i);
      out.push(val.trim());
      if (c < 0) break;
      i = c + 1;
    } else {
      const c = line.indexOf(",", i);
      if (c < 0) {
        out.push(line.slice(i).trim());
        break;
      }
      out.push(line.slice(i, c).trim());
      i = c + 1;
    }
  }
  return out;
}

/** Regex that matches a line containing any of the codes as a whole field value. */
export function codeLineMatcher(codes: Iterable<string>): (line: string) => boolean {
  const alts = [...codes].map((c) => c.replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  const re = new RegExp(`(?:^|[,"|])\\s*(?:${alts.join("|")})\\s*(?:[,"|]|$)`);
  return (line) => re.test(line);
}
