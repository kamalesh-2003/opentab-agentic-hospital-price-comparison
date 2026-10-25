import { discoverFromName } from "../src/discover.js";
const log: string[] = [];
const t0 = Date.now();
const found = await discoverFromName(process.argv[2], log).catch((e) => (log.push("ERR " + e.message), null));
console.log(log.join("\n"));
console.log(found ? `FOUND ${found.hptUrl}: ${found.entries.length} entries, e.g. ${found.entries.slice(0, 3).map((e) => e.location_name).join("; ")}` : "NOT FOUND", `${(Date.now() - t0) / 1000}s`);
