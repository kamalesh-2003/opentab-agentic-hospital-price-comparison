// Benchmark the parser on a local file. Usage: npx tsx scripts/bench.ts <file> [seconds]
import { createReadStream } from "node:fs";
import { parsePriceFile } from "../src/parse.js";
import { Budget } from "../src/budget.js";
import { TARGET_CODES } from "../src/codes.js";
import { pipeline } from "node:stream";

const budget = new Budget(Number(process.argv[3] ?? 60) * 1000, 1e12);
let records = 0;
let last = { items: 0, matched: 0 };
const t0 = Date.now();
const s = pipeline(createReadStream(process.argv[2], { highWaterMark: 1 << 20 }), budget.counter(), () => {});
try {
  const meta = await parsePriceFile(s, {
    codes: new Set(Object.keys(TARGET_CODES)),
    budget,
    onMeta: () => {},
    onRows: async (r) => void (records += r.length),
    onProgress: (p) => void (last = p),
  });
  console.log(meta.format, meta.version);
} catch (e) {
  console.log("stopped:", (e as Error).message);
}
const sec = (Date.now() - t0) / 1000;
console.log(`${sec.toFixed(1)}s ${Math.round(budget.bytes / 1e6)}MB (${(budget.bytes / 1e6 / sec).toFixed(1)} MB/s) items ${last.items} (${Math.round(last.items / sec)}/s) records ${records}`);
