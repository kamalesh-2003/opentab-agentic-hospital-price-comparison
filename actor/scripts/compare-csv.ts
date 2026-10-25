// Compare fastCsv against csv-parse (relax_quotes) on a local file: row counts and sampled field equality.
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { fastCsv } from "../src/fastcsv.js";
const file = process.argv[2];
const end = Number(process.argv[3] ?? 1e12);
const a: string[][] = [];
try { for await (const r of createReadStream(file, { end }).pipe(parse({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true }))) a.push(r); } catch (e) { console.log("csv-parse stopped:", (e as Error).message.slice(0, 60)); }
const b: string[][] = [];
for await (const r of fastCsv(createReadStream(file, { end }), { headerLines: 1e9, keep: () => true })) b.push(r);
let diff = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i].join("\u0001") !== b[i].join("\u0001")) { if (diff++ < 3) console.log("DIFF row", i, "\n csv-parse:", JSON.stringify(a[i]).slice(0, 300), "\n fastCsv:  ", JSON.stringify(b[i]).slice(0, 300)); }
console.log(`csv-parse rows ${a.length}, fastCsv rows ${b.length}, differing rows ${diff}`);
